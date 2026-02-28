'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  Zap, Activity, Moon, Flame, AlertTriangle, CheckCircle2,
  Info, RotateCcw, Settings, Droplets, Ghost, Share2, Cloud, CloudOff, Download, Search,
  Users, X,
} from 'lucide-react'
import { toPng } from 'html-to-image'
import { type StoredProfile, type DailyLog } from '@/lib/local-store'
import {
  cloudLoadProfile, cloudLoadDailyLog, cloudPatchDailyLog,
  cloudResetDailyLog, cloudLoadYesterdayLog, cloudLoadRecentLogs,
  cloudLoadRecentLogsWithDates, cloudLoadLeaderboard,
  getUserId, onSyncChange, type SyncStatus, type LeaderboardEntry,
} from '@/lib/data-sync'
import { WATER_TARGET_ML, calculateExecutionScore, calculateDayScore } from '@/lib/health-engine'
import { searchFood, type FoodItem } from '@/lib/food-db'
import { useLocale, translations, interp, type Locale } from '@/lib/i18n'

// ─── Colours ──────────────────────────────────────────────────────────────────
const C = {
  calorie: '#39ff14', exercise: '#00d4ff', sleep: '#bf80ff', water: '#38bdf8',
  calBg: '#0a1a0a', exBg: '#071520', slBg: '#130a22',
  panel: '#0a0d14', border: 'rgba(57,255,20,0.15)',
}

// ─── Fallback yesterday (shown when no real data exists) ──────────────────────
const FALLBACK_YESTERDAY: DailyLog = {
  caloriesIn: 0, caloriesOut: 0, exerciseMinutes: 0,
  sleepHours: 0, waterMl: 0, flushDone: false,
}

// ─── Sound + Haptic ───────────────────────────────────────────────────────────
function playClick(major = false) {
  try { navigator.vibrate?.(major ? [25, 8, 15] : 8) } catch { /* no vibration API */ }
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    const ctx  = new Ctx()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    if (major) {
      osc.type = 'square'
      osc.frequency.setValueAtTime(1100, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + 0.07)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07)
      osc.start(); osc.stop(ctx.currentTime + 0.07)
    } else {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(900, ctx.currentTime)
      gain.gain.setValueAtTime(0.05, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035)
      osc.start(); osc.stop(ctx.currentTime + 0.035)
    }
    setTimeout(() => ctx.close(), 300)
  } catch { /* no AudioContext */ }
}

// ─── Mission text ─────────────────────────────────────────────────────────────
function getMission(log: DailyLog, targetCalories: number, t: typeof translations['en']) {
  const hour = new Date().getHours()
  const net  = log.caloriesIn - log.caloriesOut
  const bal  = targetCalories - net
  if (log.caloriesIn === 0) return t.missionStandby
  if (hour >= 21)           return t.missionSleep
  if (bal > 700)            return t.missionFatBurn
  if (bal < -300)           return t.missionRefuel
  if (log.exerciseMinutes === 0) return t.missionRecovery
  const allGood = log.exerciseMinutes >= 30 && log.sleepHours >= 7 &&
                  log.waterMl >= WATER_TARGET_ML && bal >= 0 && bal <= 500
  return allGood ? t.missionComplete : t.missionOptimal
}

// ─── Rule Engine ──────────────────────────────────────────────────────────────
type Level = 'ok' | 'warn' | 'alert' | 'info'
interface Insight { level: Level; message: string }

function runEngine(log: DailyLog, targetCalories: number, bmr: number, t: typeof translations['en']): Insight[] {
  const hour = new Date().getHours()
  const net  = log.caloriesIn - log.caloriesOut
  const bal  = targetCalories - net
  const out: Insight[] = []

  // Calorie balance
  if (log.caloriesIn === 0) {
    out.push({ level: 'info', message: t.msgAwaitingInput })
  } else if (bal > 700) {
    out.push({ level: 'warn', message: interp(t.msgDeficitHigh, { bal }) })
  } else if (bal < -300) {
    out.push({ level: 'alert', message: interp(t.msgSurplusDetected, { amt: Math.abs(bal) }) })
  } else {
    const remText = bal > 0
      ? (t.msgCalorieOk.includes('剩余') ? `剩余 ${bal} kcal。` : `${bal} kcal remaining.`)
      : (t.msgCalorieOk.includes('目标') ? '目标已达成。' : 'Target reached.')
    out.push({ level: 'ok', message: interp(t.msgCalorieOk, { rem: remText }) })
  }

  // Burn-out predictor
  if (log.caloriesIn > 0 && net > 0) {
    const fuelLeft = net / (bmr / 24)
    const depH  = Math.floor((hour + fuelLeft) % 24)
    const depM  = Math.round(((hour + fuelLeft) % 1) * 60)
    const time  = `${String(depH).padStart(2,'0')}:${String(depM).padStart(2,'0')}`
    if (fuelLeft < 1.5) out.push({ level: 'alert', message: t.msgCrashImminent })
    else if (fuelLeft < 3) out.push({ level: 'warn', message: interp(t.msgLowFuel, { time }) })
    else out.push({ level: 'info', message: interp(t.msgFuelPrediction, { time }) })
  } else if (log.caloriesIn === 0) {
    out.push({ level: 'alert', message: t.msgNoFuel })
  }

  // Late night guard
  if (hour >= 21 && net > targetCalories * 0.9)
    out.push({ level: 'alert', message: t.msgFuelingClosed })

  // Exercise
  if (log.exerciseMinutes === 0)       out.push({ level: 'warn',  message: t.msgExerciseDeficit })
  else if (log.exerciseMinutes >= 60)  out.push({ level: 'ok',    message: interp(t.msgHighOutput,         { min: log.exerciseMinutes }) })
  else if (log.exerciseMinutes >= 30)  out.push({ level: 'ok',    message: interp(t.msgExerciseGoalMet,    { min: log.exerciseMinutes }) })
  else                                 out.push({ level: 'info',   message: interp(t.msgExerciseInProgress, { min: log.exerciseMinutes, rem: 30 - log.exerciseMinutes }) })

  // Sleep
  if (log.sleepHours === 0)      out.push({ level: 'info',  message: t.msgSleepMissing })
  else if (log.sleepHours < 6)  out.push({ level: 'alert', message: interp(t.msgSleepCritical,   { h: log.sleepHours }) })
  else if (log.sleepHours < 7)  out.push({ level: 'warn',  message: interp(t.msgSleepSuboptimal, { h: log.sleepHours }) })
  else                          out.push({ level: 'ok',    message: interp(t.msgSleepOptimal,    { h: log.sleepHours }) })

  // Hydration
  if (hour >= 14 && log.waterMl < 1000)
    out.push({ level: 'alert', message: t.msgHighDehydration })
  else if (log.waterMl >= WATER_TARGET_ML)
    out.push({ level: 'ok',   message: interp(t.msgHydrationOptimal, { ml: log.waterMl }) })
  else
    out.push({ level: 'info', message: interp(t.msgHydration, { ml: log.waterMl, total: WATER_TARGET_ML, rem: WATER_TARGET_ML - log.waterMl }) })

  // Metabolic
  if (hour >= 18 && !log.flushDone)
    out.push({ level: 'warn', message: t.msgMetabolicSluggishness })

  return out
}

// ─── Chart data ───────────────────────────────────────────────────────────────
function buildChart(net: number, target: number, displayHour: number) {
  const rate = displayHour > 0 ? net / displayHour : 0
  return Array.from({ length: 25 }, (_, h) => ({
    label:     `${String(h).padStart(2,'0')}:00`,
    target,
    actual:    h <= displayHour ? Math.round(rate * h)                        : undefined,
    projected: h >= displayHour ? Math.round(net + rate * (h - displayHour)) : undefined,
  }))
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Ring({ cx, cy, r, sw, pct, color, bgColor }: { cx:number; cy:number; r:number; sw:number; pct:number; color:string; bgColor:string }) {
  const circ = 2 * Math.PI * r
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={bgColor} strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(Math.max(pct,0),100) / 100)}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)', filter: `drop-shadow(0 0 8px ${color})` }}
      />
    </g>
  )
}

function HydrationGauge({ waterMl, t }: { waterMl:number; t: typeof translations['en'] }) {
  const pct   = Math.min((waterMl / WATER_TARGET_ML) * 100, 100)
  const color = pct >= 100 ? C.calorie : pct >= 50 ? C.water : '#f87171'
  return (
    <div className="flex-1 rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${C.water}22` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Droplets className="w-3.5 h-3.5" style={{ color: C.water }} />
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.water }}>{t.hydrationTitle}</span>
        </div>
        <span className="text-[10px] tabular-nums text-gray-400">{waterMl} / {WATER_TARGET_ML} ml</span>
      </div>
      <div className="h-2 rounded-full" style={{ background: '#071520' }}>
        <div className="h-full rounded-full" style={{ width:`${pct}%`, background:color, boxShadow:`0 0 8px ${color}`, transition:'width 0.5s ease' }} />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-600">{Math.round(pct)}{t.hydrationPctSuffix}</div>
    </div>
  )
}

function SystemClearLED({ done, t }: { done:boolean; t: typeof translations['en'] }) {
  return (
    <div className="rounded-xl p-3 flex flex-col items-center justify-center gap-2" style={{ background:C.panel, border:`1px solid ${done ? C.calorie+'44' : '#333'}` }}>
      <div className="w-4 h-4 rounded-full" style={{ background:done?C.calorie:'#2a2a2a', boxShadow:done?`0 0 12px ${C.calorie},0 0 24px ${C.calorie}55`:'none', transition:'all 0.4s ease' }} />
      <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color:done?C.calorie:'#444' }}>{done ? t.statusClear : t.statusPending}</span>
      <span className="text-[9px] text-gray-600">{t.systemClearLabel}</span>
    </div>
  )
}

function CloudSyncLED({ status, t }: { status: SyncStatus; t: typeof translations['en'] }) {
  const syncing = status === 'syncing'
  const synced  = status === 'synced'
  const offline = status === 'offline'
  const color   = syncing ? '#38bdf8' : synced ? '#39ff14' : offline ? '#f87171' : '#333'
  const label   = syncing ? t.cloudSyncing : synced ? t.cloudSynced : offline ? t.cloudOffline : t.cloudSyncLabel
  const IconC   = offline ? CloudOff : Cloud
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: `${color}08`, border: `1px solid ${color}22` }}>
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${syncing ? 'sync-pulse' : ''}`}
        style={{ background: color, color, boxShadow: synced ? `0 0 8px ${color}, 0 0 16px ${color}55` : 'none', transition: 'all 0.4s ease' }} />
      <IconC className="w-3 h-3 flex-shrink-0" style={{ color }} />
      <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color, fontFamily: 'monospace' }}>{label}</span>
    </div>
  )
}

const ICFG: Record<Level, { Icon: typeof CheckCircle2; color: string; bg: string }> = {
  ok:    { Icon: CheckCircle2,  color:'#39ff14', bg:'rgba(57,255,20,0.06)'   },
  warn:  { Icon: AlertTriangle, color:'#fbbf24', bg:'rgba(251,191,36,0.06)'  },
  alert: { Icon: AlertTriangle, color:'#f87171', bg:'rgba(248,113,113,0.06)' },
  info:  { Icon: Info,          color:'#60a5fa', bg:'rgba(96,165,250,0.06)'  },
}
function InsightRow({ i }: { i: Insight }) {
  const cfg = ICFG[i.level]
  return (
    <div className={`flex items-start gap-3 rounded-lg px-3 py-2 ${i.level==='alert'?'nexus-glitch':''}`}
      style={{ background:cfg.bg, border:`1px solid ${cfg.color}${i.level==='alert'?'55':'22'}`, boxShadow:i.level==='alert'?`0 0 12px ${cfg.color}22`:'none' }}>
      <cfg.Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color:cfg.color }} />
      <span className="text-xs leading-snug text-gray-200" style={{ fontFamily:"'Courier New',Courier,monospace", letterSpacing:'0.02em' }}>{i.message}</span>
    </div>
  )
}

function LogBtn({ label, color, onClick, active }: { label:string; color:string; onClick:()=>void; active?:boolean }) {
  return (
    <button onClick={onClick}
      className="rounded-lg px-3 py-2 text-xs font-bold tracking-wide transition-all hover:scale-105 active:scale-95"
      style={{ background:active?`${color}30`:`${color}12`, border:`1px solid ${active?color:color+'44'}`, color, textShadow:active?`0 0 8px ${color}`:'none', boxShadow:active?`0 0 10px ${color}44`:'none' }}>
      {label}
    </button>
  )
}

// ─── Energy Chart + Time-travel slider ───────────────────────────────────────
interface ChartProps { net:number; targetCalories:number; ghostMode:boolean; simHour:number|null; onSimHour:(h:number|null)=>void; t: typeof translations['en'] }

function EnergyTrendChart({ net, targetCalories, ghostMode, simHour, onSimHour, t }: ChartProps) {
  const realHour    = new Date().getHours()
  const displayHour = simHour ?? (ghostMode ? 24 : realHour)
  const isSimulating = simHour !== null
  const overBudget   = net > targetCalories
  const lineColor    = overBudget ? '#ff4444' : C.exercise
  const data         = buildChart(net, targetCalories, displayHour)

  function TTip({ active, payload, label }: { active?:boolean; payload?:Array<{name:string;value:number;color:string}>; label?:string }) {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg px-3 py-2 text-xs" style={{ background:'#0d1420', border:`1px solid ${C.border}`, fontFamily:'monospace' }}>
        <div className="text-gray-500 mb-1">{label}</div>
        {payload.map(p => p.value!=null && <div key={p.name} style={{ color:p.color }}>{p.name}: {p.value.toLocaleString()} kcal</div>)}
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-5 w-full" style={{ background:C.panel, border:`1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full" style={{ background:C.sleep, boxShadow:`0 0 8px ${C.sleep}` }} />
          <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color:C.sleep, fontFamily:'monospace' }}>
            {ghostMode ? t.yesterdayTimeline : t.energyTimeline}
            {isSimulating && <span style={{ color:C.calorie }}> — {t.simulating} {String(displayHour).padStart(2,'0')}:00</span>}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[9px]" style={{ fontFamily:'monospace' }}>
          {[{ lbl:t.chartTarget,col:C.calorie,dim:false },{ lbl:t.chartActual,col:lineColor,dim:false },{ lbl:t.chartProjected,col:lineColor,dim:true }].map(s=>(
            <span key={s.lbl} className="flex items-center gap-1" style={{ opacity:s.dim?0.5:1 }}>
              <span className="inline-block w-4 h-px" style={{ background:s.col }} />
              <span style={{ color:s.col }}>{s.lbl}</span>
            </span>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top:4,right:4,left:-20,bottom:0 }}>
          <defs>
            <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.calorie}  stopOpacity={0.1} /><stop offset="95%" stopColor={C.calorie}  stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={lineColor} stopOpacity={0.25} /><stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fill:'#444',fontSize:9,fontFamily:'monospace' }} tickLine={false} axisLine={false} interval={3} />
          <YAxis tick={{ fill:'#444',fontSize:9,fontFamily:'monospace' }} tickLine={false} axisLine={false} />
          <Tooltip content={<TTip />} />
          <ReferenceLine y={targetCalories} stroke={`${C.calorie}33`} strokeDasharray="4 4" />
          {isSimulating && data[displayHour] && <ReferenceLine x={data[displayHour].label} stroke={C.sleep} strokeDasharray="3 3" />}
          <Area type="monotone" dataKey="target"    name={t.chartTarget}    stroke={C.calorie}  strokeWidth={1.5} strokeDasharray="4 4" fill="url(#gT)" dot={false} connectNulls />
          <Area type="monotone" dataKey="actual"    name={t.chartActual}    stroke={lineColor}  strokeWidth={2}   fill="url(#gA)" dot={false} connectNulls={false} style={{ filter:`drop-shadow(0 0 4px ${lineColor})` }} />
          <Area type="monotone" dataKey="projected" name={t.chartProjected} stroke={lineColor}  strokeWidth={1.5} strokeDasharray="3 3" strokeOpacity={0.4} fill="none" dot={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Time-travel slider */}
      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between" style={{ fontFamily:'monospace' }}>
          <span className="text-[9px]" style={{ color:C.calorie }}>{t.timeTravelLabel}</span>
          {isSimulating
            ? <button onClick={() => { onSimHour(null); playClick() }}
                className="px-2 py-1 rounded text-[9px] font-bold transition-all hover:scale-105"
                style={{ background:`${C.calorie}22`, border:`1px solid ${C.calorie}88`, color:C.calorie, boxShadow:`0 0 8px ${C.calorie}44` }}>
                {t.backRealtime}
              </button>
            : <span className="text-[9px] text-gray-600">{String(realHour).padStart(2,'0')}:00 · {t.liveMode}</span>
          }
        </div>
        <input type="range" min={0} max={23} step={1}
          value={simHour ?? realHour}
          onChange={e => { const h = parseInt(e.target.value); onSimHour(h===realHour ? null : h); playClick() }}
          className="cockpit-slider"
        />
        <div className="flex justify-between text-[8px] text-gray-700" style={{ fontFamily:'monospace' }}>
          {['00','06','12','18','23'].map(h => <span key={h}>{h}:00</span>)}
        </div>
      </div>
    </div>
  )
}

// ─── Weekly Efficiency Sparkline (V1.6) ──────────────────────────────────────
function WeeklySparkline({ scores, t }: { scores: { date: string; score: number }[]; t: typeof translations['en'] }) {
  if (scores.length === 0) return null
  const avg = Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length)
  const avgColor = avg >= 70 ? C.calorie : avg >= 40 ? '#fbbf24' : '#f87171'
  return (
    <div className="rounded-2xl p-5 w-full" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full" style={{ background: C.calorie, boxShadow: `0 0 8px ${C.calorie}` }} />
          <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color: C.calorie, fontFamily: 'monospace' }}>
            {t.weeklyEfficiencyTitle}
          </span>
        </div>
        <span className="text-[10px] font-bold" style={{ color: avgColor, fontFamily: 'monospace' }}>
          {t.weeklyAvgLabel} {avg}%
        </span>
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={scores} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: '#444', fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: '#444', fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: '#0d1420', border: `1px solid ${C.border}`, fontFamily: 'monospace', fontSize: 10 }}
            labelStyle={{ color: '#666' }}
            formatter={(value: number | string | undefined) => [`${value ?? 0}%`, 'SYS_EFF']}
          />
          <ReferenceLine y={70} stroke={`${C.calorie}33`} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="score" name="SYS_EFF" stroke={C.calorie} strokeWidth={2}
            dot={{ r: 3, fill: C.calorie, stroke: C.calorie }}
            style={{ filter: `drop-shadow(0 0 4px ${C.calorie})` }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── News Ticker (V1.6) ─────────────────────────────────────────────────────
function NewsTicker({ leaderboard, t }: { leaderboard: LeaderboardEntry[]; t: typeof translations['en'] }) {
  const count  = leaderboard.length
  const avgEff = count > 0 ? Math.round(leaderboard.reduce((s, e) => s + e.score, 0) / count) : 0
  const top    = count > 0 ? leaderboard[0].score : 0

  const items = [
    `${t.tickerGlobalEff}: ${avgEff}%`,
    `${t.tickerActiveOps}: ${count}`,
    t.tickerSystemStable,
    `${t.tickerTopScore}: ${top}%`,
    'NEXUS V1.6',
  ]
  const text = items.join('  ///  ')

  return (
    <div className="overflow-hidden" style={{ background: '#050508', borderBottom: `1px solid ${C.border}`, height: '22px' }}>
      <div className="nexus-ticker text-[9px] font-bold tracking-[0.15em] uppercase leading-[22px]"
        style={{ color: `${C.calorie}88`, fontFamily: 'monospace' }}>
        <span>{text}</span>
        <span className="ml-16">{text}</span>
      </div>
    </div>
  )
}

// ─── Squad Status Panel (V1.6) ──────────────────────────────────────────────
function SquadStatusPanel({ entries, open, onClose, currentUserId, t }: {
  entries: LeaderboardEntry[]; open: boolean; onClose: () => void; currentUserId: string; t: typeof translations['en']
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm h-full overflow-y-auto"
        style={{ background: '#0a0d14', borderLeft: `1px solid ${C.border}` }}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3"
          style={{ background: '#0a0d14', borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: C.calorie }} />
            <span className="text-[10px] font-black tracking-[0.25em] uppercase"
              style={{ color: C.calorie, fontFamily: 'monospace' }}>{t.squadTitle}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {entries.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-8 h-8 mx-auto mb-2" style={{ color: '#333' }} />
              <span className="text-[10px] text-gray-600" style={{ fontFamily: 'monospace' }}>{t.squadEmpty}</span>
            </div>
          ) : entries.map((entry, idx) => {
            const isMe = entry.userId === currentUserId
            const rankColor = idx === 0 ? '#ffd700' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#555'
            const scoreColor = entry.score >= 70 ? C.calorie : entry.score >= 40 ? '#fbbf24' : '#f87171'
            const goalLabel = entry.goal === 'loss' ? t.goalLoss : entry.goal === 'gain' ? t.goalGain : t.goalMaintain
            return (
              <div key={entry.userId}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                style={{
                  background: isMe ? `${C.calorie}08` : C.panel,
                  border: `1px solid ${isMe ? C.calorie + '44' : C.border}`,
                }}>
                <span className="text-sm font-black w-6 text-center" style={{ color: rankColor, fontFamily: 'monospace' }}>
                  {idx < 3 ? ['I', 'II', 'III'][idx] : `${idx + 1}`}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold truncate" style={{ color: isMe ? C.calorie : '#aaa', fontFamily: 'monospace' }}>
                    {isMe ? t.squadYou : `OP-${entry.userId.slice(0, 6).toUpperCase()}`}
                  </div>
                  <div className="text-[9px] text-gray-600" style={{ fontFamily: 'monospace' }}>{goalLabel}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black tabular-nums" style={{ color: scoreColor, textShadow: `0 0 6px ${scoreColor}88` }}>
                    {entry.score}%
                  </div>
                  <div className="text-[8px] text-gray-600" style={{ fontFamily: 'monospace' }}>SYS_EFF</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Sticky Quick-Log bar ─────────────────────────────────────────────────────
type Tab = 'cal' | 'ex' | 'water' | 'sleep' | 'sys'

function StickyQuickLog({ log, ghostMode, locale, t, onPatch, onReset }: {
  log:DailyLog; ghostMode:boolean; locale:'en'|'cn'; t: typeof translations['en']
  onPatch:(d:Partial<DailyLog>,major?:boolean)=>void; onReset:()=>void
}) {
  const [tab, setTab] = useState<Tab>('cal')
  const [foodQuery, setFoodQuery] = useState('')
  const dis = ghostMode
  const results = foodQuery ? searchFood(foodQuery, locale) : []

  const panels: Record<Tab, React.ReactNode> = {
    cal: <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
      <div className="relative flex-1 min-w-[140px] max-w-[220px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 pointer-events-none" />
        <input value={foodQuery} onChange={e => setFoodQuery(e.target.value)}
          placeholder={t.foodSearchPlaceholder}
          className="w-full bg-transparent border rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-white placeholder-gray-600 focus:outline-none"
          style={{ borderColor:`${C.calorie}44`, fontFamily:'monospace' }} />
      </div>
      {foodQuery ? (
        results.length > 0 ? results.map((f: FoodItem) => (
          <button key={f.id} onClick={() => { if (!dis) { onPatch({ caloriesIn: f.kcal }, true); setFoodQuery('') } }}
            className="rounded-lg px-2 py-1.5 text-[10px] font-bold tracking-wide transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5"
            style={{ background:`${C.calorie}12`, border:`1px solid ${C.calorie}44`, color:C.calorie, fontFamily:'monospace' }}>
            <span>{locale==='cn'?f.nameCn:f.name}</span>
            <span className="opacity-60">{f.kcal}</span>
          </button>
        )) : <span className="text-[10px] text-gray-600" style={{ fontFamily:'monospace' }}>{t.foodSearchEmpty}</span>
      ) : <>
        <LogBtn label="+300 kcal" color={C.calorie} onClick={() => !dis && onPatch({ caloriesIn: 300 }, true)} />
        <LogBtn label="+500 kcal" color={C.calorie} onClick={() => !dis && onPatch({ caloriesIn: 500 }, true)} />
        <LogBtn label="+800 kcal" color={C.calorie} onClick={() => !dis && onPatch({ caloriesIn: 800 }, true)} />
        <LogBtn label="−300 kcal" color="#f87171"   onClick={() => !dis && onPatch({ caloriesIn: -300 })} />
      </>}
    </div>,
    ex: <>
      <LogBtn label="+15 min"  color={C.exercise} onClick={() => !dis && onPatch({ exerciseMinutes:15,  caloriesOut:105 }, true)} />
      <LogBtn label="+30 min"  color={C.exercise} onClick={() => !dis && onPatch({ exerciseMinutes:30,  caloriesOut:210 }, true)} />
      <LogBtn label="+60 min"  color={C.exercise} onClick={() => !dis && onPatch({ exerciseMinutes:60,  caloriesOut:420 }, true)} />
    </>,
    water: <>
      <LogBtn label="+250 ml"  color={C.water} onClick={() => !dis && onPatch({ waterMl: 250  })} />
      <LogBtn label="+500 ml"  color={C.water} onClick={() => !dis && onPatch({ waterMl: 500  })} />
      <LogBtn label="+1000 ml" color={C.water} onClick={() => !dis && onPatch({ waterMl: 1000 })} />
    </>,
    sleep: <>
      <LogBtn label="+1 hr"  color={C.sleep} onClick={() => !dis && onPatch({ sleepHours:1 })} />
      <LogBtn label="+6 hrs" color={C.sleep} onClick={() => !dis && onPatch({ sleepHours:6 })} />
      <LogBtn label="+8 hrs" color={C.sleep} onClick={() => !dis && onPatch({ sleepHours:8 })} />
    </>,
    sys: <>
      <LogBtn label={log.flushDone ? t.flushDone : t.flushPending} color={C.calorie} active={log.flushDone}
        onClick={() => !dis && onPatch({ flushDone:!log.flushDone })} />
      <button onClick={() => { if (!dis){ onReset(); playClick() } }} disabled={dis}
        className="flex items-center gap-1.5 text-[10px] text-gray-600 hover:text-gray-400 disabled:opacity-30 transition-colors ml-2"
        style={{ fontFamily:'monospace' }}>
        <RotateCcw className="w-3 h-3" /> {t.resetBtn}
      </button>
    </>,
  }

  const tabs: { id:Tab; Icon: typeof Flame; label:string; color:string }[] = [
    { id:'cal',   Icon:Flame,    label:t.tabCal,   color:C.calorie  },
    { id:'ex',    Icon:Activity, label:t.tabEx,    color:C.exercise },
    { id:'water', Icon:Droplets, label:t.tabWater, color:C.water    },
    { id:'sleep', Icon:Moon,     label:t.tabSleep, color:C.sleep    },
    { id:'sys',   Icon:Settings, label:t.tabSys,   color:'#888'     },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30" style={{ background:'#0a0d14', borderTop:`1px solid ${C.border}` }}>
      {/* Button row */}
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap min-h-[48px]" style={{ borderBottom:'1px solid #1a1a1a' }}>
        {dis
          ? <span className="text-[10px] text-gray-600" style={{ fontFamily:'monospace' }}>{t.readOnly}</span>
          : panels[tab]
        }
      </div>
      {/* Tab bar */}
      <div className="flex">
        {tabs.map(tb => {
          const active = tab === tb.id
          return (
            <button key={tb.id} onClick={() => { setTab(tb.id); playClick() }}
              className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors"
              style={{ color:active?tb.color:'#444', borderTop:`2px solid ${active?tb.color:'transparent'}` }}>
              <tb.Icon className="w-4 h-4" />
              <span className="text-[9px] font-bold" style={{ fontFamily:'monospace' }}>{tb.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ExecutiveDashboard() {
  const router = useRouter()
  const [locale, setLocale] = useLocale()
  const t = translations[locale]

  const [data,            setData]            = useState<StoredProfile | null>(null)
  const [log,             setLog]             = useState<DailyLog>({ caloriesIn:0, caloriesOut:0, exerciseMinutes:0, sleepHours:0, waterMl:0, flushDone:false })
  const [yesterdayLog,    setYesterdayLog]    = useState<DailyLog>(FALLBACK_YESTERDAY)
  const [hasYesterday,    setHasYesterday]    = useState(false)
  const [ghostMode,       setGhostMode]       = useState(false)
  const [simHour,         setSimHour]         = useState<number | null>(null)
  const [pulseRings,      setPulseRings]      = useState(false)
  const [hydrated,        setHydrated]        = useState(false)
  const [syncStatus,      setSyncStatus]      = useState<SyncStatus>('idle')
  const [shareGenerating, setShareGenerating] = useState(false)
  const [execScore,       setExecScore]       = useState<number | null>(null)
  const [weeklyScores,    setWeeklyScores]    = useState<{ date: string; score: number }[]>([])
  const [leaderboard,     setLeaderboard]     = useState<LeaderboardEntry[]>([])
  const [squadOpen,       setSquadOpen]       = useState(false)
  const snapshotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function init() {
      const profile = await cloudLoadProfile()
      if (!profile) { router.push('/profile'); return }
      const dailyLog = await cloudLoadDailyLog()
      setData(profile)
      setLog(dailyLog)
      setHydrated(true)
      // Pre-fetch yesterday's log for Ghost Mode
      const yd = await cloudLoadYesterdayLog()
      if (yd) { setYesterdayLog(yd); setHasYesterday(true) }
      // Calculate execution score from last 3 days
      const recent = await cloudLoadRecentLogs(3)
      if (recent.length > 0) {
        setExecScore(calculateExecutionScore(recent, profile.metrics.targetCalories))
      }
      // V1.6: Weekly sparkline (7 days)
      const weekly = await cloudLoadRecentLogsWithDates(7)
      if (weekly.length > 0) {
        setWeeklyScores(weekly.map(({ date, log: dl }) => ({
          date: date.slice(5), // MM-DD
          score: calculateDayScore(dl, profile.metrics.targetCalories),
        })).reverse())
      }
      // V1.6: Leaderboard
      const lb = await cloudLoadLeaderboard()
      setLeaderboard(lb)
    }
    init()
    const unsub = onSyncChange(setSyncStatus)
    return unsub
  }, [router])

  const patch = useCallback((delta: Partial<DailyLog>, major = false) => {
    playClick(major)
    cloudPatchDailyLog(delta).then(next => setLog(next))
    if (major) { setPulseRings(true); setTimeout(() => setPulseRings(false), 800) }
  }, [])

  const handleReset  = useCallback(() => { playClick(); cloudResetDailyLog().then(next => setLog(next)) }, [])
  const toggleLocale = useCallback(() => { playClick(); setLocale(locale === 'cn' ? 'en' : 'cn') }, [locale, setLocale])

  const handleShare = useCallback(async () => {
    if (!snapshotRef.current || shareGenerating) return
    playClick(true)
    setShareGenerating(true)
    try {
      const dataUrl = await toPng(snapshotRef.current, {
        backgroundColor: '#050508',
        pixelRatio: 2,
        style: { paddingBottom: '20px' },
      })
      const link = document.createElement('a')
      link.download = `${t.shareFilename}-${new Date().toISOString().slice(0,10)}.png`
      link.href = dataUrl
      link.click()
    } catch { /* capture failed */ }
    setShareGenerating(false)
  }, [shareGenerating, t.shareFilename])

  // Ghost or live base log
  const displayLog = ghostMode ? yesterdayLog : log

  // Time-travel: scale to simulated hour
  const activeLog = useMemo<DailyLog>(() => {
    if (simHour === null) return displayLog
    const rh = new Date().getHours()
    if (rh === 0) return displayLog
    const f = simHour / rh
    return {
      ...displayLog,
      caloriesIn:      Math.round(displayLog.caloriesIn      * f),
      caloriesOut:     Math.round(displayLog.caloriesOut     * f),
      exerciseMinutes: Math.round(displayLog.exerciseMinutes * f),
      waterMl:         Math.round(displayLog.waterMl         * f),
      sleepHours:      simHour >= 8  ? displayLog.sleepHours : 0,
      flushDone:       simHour >= 12 ? displayLog.flushDone  : false,
    }
  }, [simHour, displayLog])

  if (!hydrated || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background:'#050508' }}>
        <Zap className="w-5 h-5 animate-pulse mr-3" style={{ color:C.calorie }} />
        <span className="text-sm uppercase tracking-widest text-gray-400" style={{ fontFamily:'monospace' }}>INITIALISING…</span>
      </div>
    )
  }

  const { metrics } = data
  const net      = activeLog.caloriesIn - activeLog.caloriesOut
  const balance  = metrics.targetCalories - net
  const calColor = net > metrics.targetCalories ? '#ff4444' : C.calorie
  const calPct   = Math.min((net / metrics.targetCalories) * 100, 100)
  const exPct    = Math.min((activeLog.exerciseMinutes / 30) * 100, 100)
  const sleepPct = Math.min((activeLog.sleepHours / 8) * 100, 100)
  const insights = runEngine(activeLog, metrics.targetCalories, metrics.bmr, t)
  const hasAlert = insights.some(i => i.level === 'alert')
  const mission  = getMission(activeLog, metrics.targetCalories, t)
  const dateStr  = new Date().toLocaleDateString(locale==='cn' ? 'zh-CN' : 'en-US', { weekday:'short', month:'short', day:'numeric' })

  // Unused locale variable to satisfy TypeScript - locale is used in useLocale and toggleLocale
  const _locale: Locale = locale

  return (
    <div className="min-h-screen text-white pb-36 nexus-scanline" style={{ background:'#050508' }}>

      {/* ── News Ticker (V1.6) ── */}
      <NewsTicker leaderboard={leaderboard} t={t} />

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3" style={{ background:'#0a0d14', borderBottom:`1px solid ${C.border}` }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center" style={{ background:`${C.calorie}18`, border:`1px solid ${C.calorie}44` }}>
            <Zap className="w-4 h-4" style={{ color:C.calorie }} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black tracking-[0.2em] uppercase" style={{ color:C.calorie, textShadow:`0 0 10px ${C.calorie}66` }}>Nexus Health</div>
            <div className="text-[9px] truncate flex items-center gap-2" style={{ fontFamily:'monospace', color:'#555' }}>
              {t.missionPrefix} <span style={{ color:hasAlert?'#f87171':C.calorie }}>{mission}</span>
              {execScore !== null && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black"
                  style={{
                    background: execScore >= 70 ? `${C.calorie}18` : execScore >= 40 ? '#fbbf2418' : '#f8717118',
                    color: execScore >= 70 ? C.calorie : execScore >= 40 ? '#fbbf24' : '#f87171',
                    border: `1px solid ${execScore >= 70 ? C.calorie : execScore >= 40 ? '#fbbf24' : '#f87171'}33`,
                    textShadow: `0 0 6px ${execScore >= 70 ? C.calorie : execScore >= 40 ? '#fbbf24' : '#f87171'}88`,
                  }}>
                  {t.execScoreLabel} {execScore}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Tactical Share */}
          <button onClick={handleShare} disabled={shareGenerating}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase transition-all hover:scale-105 disabled:opacity-60 ${shareGenerating ? 'share-shimmer' : ''}`}
            style={{ background:`${C.calorie}12`, border:`1px solid ${C.calorie}44`, color:C.calorie, fontFamily:'monospace' }}>
            {shareGenerating ? <Download className="w-3 h-3 animate-pulse" /> : <Share2 className="w-3 h-3" />}
            {shareGenerating ? t.shareGenerating : t.shareBtn}
          </button>
          {/* Squad Status */}
          <button onClick={() => { setSquadOpen(true); playClick() }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase transition-all hover:scale-105"
            style={{ background:`${C.exercise}12`, border:`1px solid ${C.exercise}44`, color:C.exercise, fontFamily:'monospace' }}>
            <Users className="w-3 h-3" />
            {t.squadBtn}
          </button>
          {/* CN/EN toggle */}
          <button onClick={toggleLocale}
            className="px-2.5 py-1 rounded-md text-[11px] font-black tracking-widest transition-all hover:scale-105"
            style={{ background:`${C.exercise}18`, border:`1px solid ${C.exercise}55`, color:C.exercise, fontFamily:'monospace' }}>
            {_locale === 'cn' ? 'EN' : 'CN'}
          </button>
          {/* Ghost toggle */}
          <button onClick={() => { setGhostMode(g=>!g); playClick() }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase transition-all"
            style={{ background:ghostMode?`${C.sleep}22`:'transparent', border:`1px solid ${ghostMode?C.sleep:'#333'}`, color:ghostMode?C.sleep:'#444', fontFamily:'monospace', boxShadow:ghostMode?`0 0 8px ${C.sleep}44`:'none' }}>
            <Ghost className="w-3 h-3" />
            {ghostMode ? t.ghostToggle : t.liveMode}
          </button>
          <span className="text-[9px] text-gray-600 hidden sm:block" style={{ fontFamily:'monospace' }}>{dateStr}</span>
          <button onClick={() => router.push('/profile')} className="p-1.5 rounded-md text-gray-600 hover:text-gray-300 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Ghost banner */}
      {ghostMode && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-[10px] font-bold tracking-widest uppercase" style={{ background:`${C.sleep}12`, borderBottom:`1px solid ${C.sleep}33`, color:C.sleep, fontFamily:'monospace' }}>
          <Ghost className="w-3 h-3" /> {t.ghostBanner}
        </div>
      )}
      {/* Alert banner */}
      {hasAlert && !ghostMode && (
        <div className="nexus-glitch flex items-center justify-center gap-2 py-1.5 text-[10px] font-bold tracking-widest" style={{ background:'rgba(248,113,113,0.08)', borderBottom:'1px solid rgba(248,113,113,0.2)', color:'#f87171', fontFamily:'monospace' }}>
          <AlertTriangle className="w-3 h-3" /> {t.alertBanner}
        </div>
      )}
      {/* Ghost: no data fallback */}
      {ghostMode && !hasYesterday && (
        <div className="flex flex-col items-center justify-center gap-3 py-8 px-4" style={{ fontFamily:'monospace' }}>
          <Ghost className="w-10 h-10" style={{ color:`${C.sleep}44` }} />
          <span className="text-sm font-bold tracking-widest uppercase" style={{ color:C.sleep }}>{t.ghostNoData}</span>
          <span className="text-[10px] text-gray-600 text-center max-w-xs">{t.ghostNoDataHint}</span>
        </div>
      )}

      <div ref={snapshotRef} className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Watermark — visible only in snapshot */}
        <div className="flex items-center justify-between" style={{ fontFamily:'monospace' }}>
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3" style={{ color:C.calorie }} />
            <span className="text-[8px] font-black tracking-[0.3em] uppercase" style={{ color:`${C.calorie}66` }}>{t.shareWatermark}</span>
          </div>
          <span className="text-[8px] tracking-wider" style={{ color:'#333' }}>
            {new Date().toLocaleString(locale==='cn'?'zh-CN':'en-US')} · V1.6
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── LEFT: Rings ── */}
          <div className="flex flex-col items-center gap-5">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-[10px] font-bold tracking-[0.3em] uppercase text-gray-600" style={{ fontFamily:'monospace' }}>{t.dailyProgress}</h2>
              {ghostMode && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background:`${C.sleep}15`, color:C.sleep, border:`1px solid ${C.sleep}33`, fontFamily:'monospace' }}>{t.yesterdayTag}</span>}
              {simHour !== null && <span className="text-[9px] px-2 py-0.5 rounded-full animate-pulse" style={{ background:`${C.calorie}15`, color:C.calorie, border:`1px solid ${C.calorie}44`, fontFamily:'monospace' }}>{t.simulating} {String(simHour).padStart(2,'0')}:00</span>}
            </div>

            {/* Rings with pulse wrapper */}
            <div className={pulseRings ? 'ring-pulse' : ''}>
              <div className="relative w-[300px] h-[300px]">
                <svg width={300} height={300} viewBox="0 0 300 300" style={{ transform:'rotate(-90deg)' }}>
                  <Ring cx={150} cy={150} r={130} sw={15} pct={calPct}   color={calColor}   bgColor={C.calBg} />
                  <Ring cx={150} cy={150} r={100} sw={15} pct={exPct}    color={C.exercise} bgColor={C.exBg}  />
                  <Ring cx={150} cy={150} r={70}  sw={15} pct={sleepPct} color={C.sleep}    bgColor={C.slBg}  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-1" style={{ fontFamily:'monospace' }}>{ghostMode?t.yesterdayCenter:t.netIntake}</div>
                  <div className="text-3xl font-black tabular-nums" style={{ color:calColor, textShadow:`0 0 20px ${calColor}88` }}>{net.toLocaleString()}</div>
                  <div className="text-[11px] text-gray-500">/ {metrics.targetCalories.toLocaleString()} kcal</div>
                  <div className="mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:balance>=0?`${C.calorie}15`:'#ff444415', color:balance>=0?C.calorie:'#ff4444', border:`1px solid ${balance>=0?C.calorie:'#ff4444'}33`, fontFamily:'monospace' }}>
                    {balance>=0 ? `▼ ${balance} ${t.remaining}` : `▲ ${Math.abs(balance)} ${t.over}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-5">
              {[
                { icon:<Flame    className="w-3.5 h-3.5" />, label:t.legendCalories, val:`${Math.round(calPct)}%`,          color:calColor   },
                { icon:<Activity className="w-3.5 h-3.5" />, label:t.legendExercise, val:`${activeLog.exerciseMinutes} min`, color:C.exercise },
                { icon:<Moon     className="w-3.5 h-3.5" />, label:t.legendSleep,    val:`${activeLog.sleepHours} h`,        color:C.sleep    },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span style={{ color:s.color }}>{s.icon}</span>
                  <div>
                    <div className="font-semibold text-[11px]" style={{ color:s.color }}>{s.label}</div>
                    <div className="text-gray-500 text-[10px]">{s.val}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-stretch gap-3 w-full">
              <HydrationGauge waterMl={activeLog.waterMl} t={t} />
              <SystemClearLED done={activeLog.flushDone} t={t} />
            </div>

            <div className="grid grid-cols-3 gap-3 w-full">
              {[
                { label:t.bmrLabel,    value:metrics.bmr,            color:'#60a5fa' },
                { label:t.tdeeLabel,   value:metrics.tdee,           color:'#fb923c' },
                { label:t.targetLabel, value:metrics.targetCalories, color:C.calorie },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-3 text-center" style={{ background:C.panel, border:`1px solid ${s.color}22` }}>
                  <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color:s.color, fontFamily:'monospace' }}>{s.label}</div>
                  <div className="text-lg font-black tabular-nums">{s.value.toLocaleString()}</div>
                  <div className="text-[9px] text-gray-600">kcal</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: System Status ── */}
          <div className="flex flex-col gap-5">
            <div className="rounded-2xl p-5" style={{ background:C.panel, border:`1px solid ${C.border}` }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-4 rounded-full" style={{ background:C.calorie, boxShadow:`0 0 8px ${C.calorie}` }} />
                <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color:C.calorie, fontFamily:'monospace' }}>{t.systemStatusTitle}</span>
                {hasAlert && <span className="ml-auto text-[9px] animate-pulse" style={{ color:'#f87171', fontFamily:'monospace' }}>{t.alertDot}</span>}
              </div>
              <div className="space-y-2">
                {insights.map((ins, idx) => <InsightRow key={idx} i={ins} />)}
              </div>
              {/* Cloud Sync LED */}
              <div className="mt-4 pt-3" style={{ borderTop:`1px solid ${C.border}` }}>
                <CloudSyncLED status={syncStatus} t={t} />
              </div>
            </div>

            <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background:C.panel, border:`1px solid ${C.border}` }}>
              <span className="text-[9px] uppercase tracking-widest text-gray-600" style={{ fontFamily:'monospace' }}>{t.profileLabel}</span>
              <span className="text-[11px] text-gray-400 capitalize">
                {data.profile.gender} · {data.profile.age}y · {data.profile.weightKg}kg ·{' '}
                <span style={{ color:C.calorie }}>
                  {data.profile.goal==='loss' ? t.goalLoss : data.profile.goal==='gain' ? t.goalGain : t.goalMaintain}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ── Energy Timeline ── */}
        <EnergyTrendChart
          net={net} targetCalories={metrics.targetCalories}
          ghostMode={ghostMode} simHour={simHour} onSimHour={setSimHour} t={t}
        />

        {/* ── Weekly Efficiency Sparkline (V1.6) ── */}
        <WeeklySparkline scores={weeklyScores} t={t} />
      </div>

      {/* ── Sticky Quick Log ── */}
      <StickyQuickLog log={log} ghostMode={ghostMode} locale={locale} t={t} onPatch={patch} onReset={handleReset} />

      {/* ── Squad Status Panel (V1.6) ── */}
      <SquadStatusPanel
        entries={leaderboard} open={squadOpen}
        onClose={() => setSquadOpen(false)}
        currentUserId={getUserId()} t={t}
      />
    </div>
  )
}
