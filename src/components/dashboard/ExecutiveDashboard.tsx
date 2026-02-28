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
  Users, X, Archive, FileBarChart, Sun, CloudSun, Plus, Trash2,
} from 'lucide-react'
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from 'motion/react'
import { toPng } from 'html-to-image'
import { type StoredProfile, type DailyLog, loadFoodFrequency, bumpFoodFrequency, type TacticalMacro, loadMacros, saveMacro, deleteMacro } from '@/lib/local-store'
import {
  cloudLoadProfile, cloudLoadDailyLog, cloudPatchDailyLog,
  cloudResetDailyLog, cloudLoadRecentLogs,
  cloudLoadRecentLogsWithDates, cloudLoadLeaderboard,
  cloudLoadLogByDate,
  getUserId, onSyncChange, type SyncStatus, type LeaderboardEntry,
} from '@/lib/data-sync'
import { WATER_TARGET_ML, calculateWaterTarget, calculateExecutionScore, calculateDayScore, getCurrentTemp, getWeatherIcon } from '@/lib/health-engine'
import { searchFood, FOOD_DB, type FoodItem } from '@/lib/food-db'
import { useLocale, translations, interp, type Locale } from '@/lib/i18n'

// ─── Colours ──────────────────────────────────────────────────────────────────
const C = {
  calorie: '#39ff14', exercise: '#00d4ff', sleep: '#bf80ff', water: '#38bdf8',
  calBg: '#0a1a0a', exBg: '#071520', slBg: '#130a22',
  panel: 'rgba(8, 12, 20, 0.72)', panelSolid: '#0a0d14',
  border: 'rgba(57,255,20,0.08)',
  borderStrong: 'rgba(57,255,20,0.15)',
}

// ─── Motion presets ──────────────────────────────────────────────────────────
const springConfig = { type: 'spring' as const, stiffness: 260, damping: 26 }
const panelVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { ...springConfig, stiffness: 200, damping: 24 } },
}
const staggerContainer = {
  visible: { transition: { staggerChildren: 0.06 } },
}
const slideOverVariants = {
  hidden: { x: '100%', opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 30 } },
  exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
}
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
}
const modalVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 20, filter: 'blur(8px)' },
  visible: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring' as const, stiffness: 300, damping: 28 } },
  exit: { opacity: 0, scale: 0.95, y: 10, filter: 'blur(4px)', transition: { duration: 0.15 } },
}

// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedCounter({ value, color, className = '', suffix = '' }: { value: number; color?: string; className?: string; suffix?: string }) {
  const spring = useSpring(0, { stiffness: 120, damping: 28 })
  const display = useTransform(spring, v => Math.round(v).toLocaleString())
  const [text, setText] = useState(value.toLocaleString())

  useEffect(() => {
    spring.set(value)
    return display.on('change', v => setText(v))
  }, [value, spring, display])

  return <span className={className} style={{ color }}>{text}{suffix}</span>
}

// ─── Fallback yesterday ──────────────────────────────────────────────────────
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

function playCriticalAlert() {
  try { navigator.vibrate?.([50, 30, 50, 30, 50]) } catch { /* no vibration API */ }
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    const ctx = new Ctx()
    for (let i = 0; i < 3; i++) {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.setValueAtTime(2200, ctx.currentTime)
      const start = ctx.currentTime + i * 0.05
      gain.gain.setValueAtTime(0.08, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.03)
      osc.start(start)
      osc.stop(start + 0.03)
    }
    setTimeout(() => ctx.close(), 500)
  } catch { /* no AudioContext */ }
}

// ─── Mission text ─────────────────────────────────────────────────────────────
type MissionResult = { text: string; critical: boolean }

function getMission(log: DailyLog, targetCalories: number, t: typeof translations['en'], waterTarget: number = WATER_TARGET_ML): MissionResult {
  const hour = new Date().getHours()
  const net  = log.caloriesIn - log.caloriesOut
  const bal  = targetCalories - net
  if (log.caloriesIn === 0)                  return { text: t.missionStandby,     critical: false }
  if (hour >= 21)                            return { text: t.missionSleep,       critical: false }
  if (hour >= 16 && bal > 800)               return { text: t.missionCriticalRefuel, critical: true }
  if (bal > 700)                             return { text: t.missionFatBurn,     critical: false }
  if (bal < -300)                            return { text: t.missionRefuel,      critical: false }
  if (log.exerciseMinutes === 0)             return { text: t.missionRecovery,    critical: false }
  const allGood = log.exerciseMinutes >= 30 && log.sleepHours >= 7 &&
                  log.waterMl >= waterTarget && bal >= 0 && bal <= 500
  return allGood ? { text: t.missionComplete, critical: false } : { text: t.missionOptimal, critical: false }
}

// ─── Rule Engine ──────────────────────────────────────────────────────────────
type Level = 'ok' | 'warn' | 'alert' | 'info'
interface Insight { level: Level; message: string }

function runEngine(log: DailyLog, targetCalories: number, bmr: number, t: typeof translations['en'], waterTarget: number = WATER_TARGET_ML): Insight[] {
  const hour = new Date().getHours()
  const net  = log.caloriesIn - log.caloriesOut
  const bal  = targetCalories - net
  const out: Insight[] = []

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

  if (hour >= 16 && bal > 800 && log.caloriesIn > 0) {
    out.push({ level: 'alert', message: interp(t.msgCriticalRefuel, { kcal: bal }) })
  }

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

  if (hour >= 21 && net > targetCalories * 0.9)
    out.push({ level: 'alert', message: t.msgFuelingClosed })

  if (log.exerciseMinutes === 0)       out.push({ level: 'warn',  message: t.msgExerciseDeficit })
  else if (log.exerciseMinutes >= 60)  out.push({ level: 'ok',    message: interp(t.msgHighOutput,         { min: log.exerciseMinutes }) })
  else if (log.exerciseMinutes >= 30)  out.push({ level: 'ok',    message: interp(t.msgExerciseGoalMet,    { min: log.exerciseMinutes }) })
  else                                 out.push({ level: 'info',   message: interp(t.msgExerciseInProgress, { min: log.exerciseMinutes, rem: 30 - log.exerciseMinutes }) })

  if (log.sleepHours === 0)      out.push({ level: 'info',  message: t.msgSleepMissing })
  else if (log.sleepHours < 6)  out.push({ level: 'alert', message: interp(t.msgSleepCritical,   { h: log.sleepHours }) })
  else if (log.sleepHours < 7)  out.push({ level: 'warn',  message: interp(t.msgSleepSuboptimal, { h: log.sleepHours }) })
  else                          out.push({ level: 'ok',    message: interp(t.msgSleepOptimal,    { h: log.sleepHours }) })

  if (hour >= 14 && log.waterMl < 1000)
    out.push({ level: 'alert', message: t.msgHighDehydration })
  else if (log.waterMl >= waterTarget)
    out.push({ level: 'ok',   message: interp(t.msgHydrationOptimal, { ml: log.waterMl }) })
  else
    out.push({ level: 'info', message: interp(t.msgHydration, { ml: log.waterMl, total: waterTarget, rem: waterTarget - log.waterMl }) })

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

// ─── Sub-components (HUD glassmorphism) ──────────────────────────────────────
function Ring({ cx, cy, r, sw, pct, color, bgColor }: { cx:number; cy:number; r:number; sw:number; pct:number; color:string; bgColor:string }) {
  const circ = 2 * Math.PI * r
  const springOffset = useSpring(circ * (1 - Math.min(Math.max(pct,0),100) / 100), { stiffness: 80, damping: 20 })
  useEffect(() => { springOffset.set(circ * (1 - Math.min(Math.max(pct,0),100) / 100)) }, [pct, circ, springOffset])
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={bgColor} strokeWidth={sw} opacity={0.5} />
      <motion.circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={circ}
        style={{ strokeDashoffset: springOffset, filter: `drop-shadow(0 0 10px ${color})` }}
        strokeLinecap="round"
      />
    </g>
  )
}

function HydrationGauge({ waterMl, waterTarget, t }: { waterMl:number; waterTarget:number; t: typeof translations['en'] }) {
  const pct   = Math.min((waterMl / waterTarget) * 100, 100)
  const color = pct >= 100 ? C.calorie : pct >= 50 ? C.water : '#f87171'
  return (
    <motion.div variants={panelVariants} className="flex-1 rounded-2xl p-3 nx-glass"
      style={{ borderColor: `${C.water}15` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Droplets className="w-3.5 h-3.5" style={{ color: C.water, filter: `drop-shadow(0 0 4px ${C.water}88)` }} />
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.water, fontFamily: 'var(--font-geist-mono)' }}>{t.hydrationTitle}</span>
        </div>
        <span className="text-[10px] tabular-nums text-gray-500" style={{ fontFamily: 'var(--font-geist-mono)' }}>{waterMl} / {waterTarget} ml</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(7,21,32,0.6)' }}>
        <motion.div className="h-full rounded-full nx-bar-fill"
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 80, damping: 18 }}
          style={{ background: `linear-gradient(90deg, ${color}88, ${color})`, boxShadow: `0 0 12px ${color}66` }} />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-600" style={{ fontFamily: 'var(--font-geist-mono)' }}>{Math.round(pct)}{t.hydrationPctSuffix}</div>
    </motion.div>
  )
}

function SystemClearLED({ done, t }: { done:boolean; t: typeof translations['en'] }) {
  return (
    <motion.div variants={panelVariants}
      className="rounded-2xl p-3 flex flex-col items-center justify-center gap-2 nx-glass"
      style={{ borderColor: done ? `${C.calorie}22` : '#222' }}>
      <motion.div className="w-5 h-5 rounded-full"
        animate={{
          background: done ? C.calorie : '#2a2a2a',
          boxShadow: done ? `0 0 16px ${C.calorie}, 0 0 32px ${C.calorie}44` : '0 0 0 transparent',
        }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }} />
      <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color:done?C.calorie:'#444', fontFamily: 'var(--font-geist-mono)' }}>{done ? t.statusClear : t.statusPending}</span>
      <span className="text-[9px] text-gray-600" style={{ fontFamily: 'var(--font-geist-mono)' }}>{t.systemClearLabel}</span>
    </motion.div>
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
    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: `${color}06`, border: `0.5px solid ${color}18` }}>
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${syncing ? 'sync-pulse' : ''}`}
        style={{ background: color, color, boxShadow: synced ? `0 0 10px ${color}, 0 0 20px ${color}44` : 'none', transition: 'all 0.4s ease' }} />
      <IconC className="w-3 h-3 flex-shrink-0" style={{ color }} />
      <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color, fontFamily: 'var(--font-geist-mono)' }}>{label}</span>
    </div>
  )
}

const ICFG: Record<Level, { Icon: typeof CheckCircle2; color: string; bg: string }> = {
  ok:    { Icon: CheckCircle2,  color:'#39ff14', bg:'rgba(57,255,20,0.04)'   },
  warn:  { Icon: AlertTriangle, color:'#fbbf24', bg:'rgba(251,191,36,0.04)'  },
  alert: { Icon: AlertTriangle, color:'#f87171', bg:'rgba(248,113,113,0.04)' },
  info:  { Icon: Info,          color:'#60a5fa', bg:'rgba(96,165,250,0.04)'  },
}
function InsightRow({ i, idx }: { i: Insight; idx: number }) {
  const cfg = ICFG[i.level]
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.04, type: 'spring', stiffness: 200, damping: 24 }}
      className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${i.level==='alert'?'nexus-glitch':''}`}
      style={{ background:cfg.bg, border:`0.5px solid ${cfg.color}${i.level==='alert'?'44':'15'}`, boxShadow:i.level==='alert'?`0 0 16px ${cfg.color}15`:'none' }}>
      <cfg.Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color:cfg.color, filter: `drop-shadow(0 0 3px ${cfg.color}88)` }} />
      <span className="text-xs leading-snug text-gray-300" style={{ fontFamily:'var(--font-geist-mono)', letterSpacing:'0.02em' }}>{i.message}</span>
    </motion.div>
  )
}

function LogBtn({ label, color, onClick, active }: { label:string; color:string; onClick:()=>void; active?:boolean }) {
  return (
    <motion.button onClick={onClick}
      whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.95 }}
      className="rounded-xl px-3 py-2 text-xs font-bold tracking-wide"
      style={{
        background: active ? `${color}18` : `${color}08`,
        border: `0.5px solid ${active ? color : color + '33'}`,
        color,
        textShadow: active ? `0 0 8px ${color}` : 'none',
        boxShadow: active ? `0 0 12px ${color}33, inset 0 1px 0 rgba(255,255,255,0.03)` : 'inset 0 1px 0 rgba(255,255,255,0.02)',
        fontFamily: 'var(--font-geist-mono)',
      }}>
      {label}
    </motion.button>
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
      <div className="rounded-xl px-3 py-2 text-xs nx-glass-strong" style={{ fontFamily:'var(--font-geist-mono)' }}>
        <div className="text-gray-500 mb-1">{label}</div>
        {payload.map(p => p.value!=null && <div key={p.name} style={{ color:p.color }}>{p.name}: {p.value.toLocaleString()} kcal</div>)}
      </div>
    )
  }

  return (
    <motion.div variants={panelVariants} className="rounded-2xl p-5 w-full nx-glass">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full" style={{ background:C.sleep, boxShadow:`0 0 8px ${C.sleep}` }} />
          <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color:C.sleep, fontFamily:'var(--font-geist-mono)' }}>
            {ghostMode ? t.yesterdayTimeline : t.energyTimeline}
            {isSimulating && <span style={{ color:C.calorie }}> — {t.simulating} {String(displayHour).padStart(2,'0')}:00</span>}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[9px]" style={{ fontFamily:'var(--font-geist-mono)' }}>
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
              <stop offset="5%"  stopColor={C.calorie}  stopOpacity={0.08} /><stop offset="95%" stopColor={C.calorie}  stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={lineColor} stopOpacity={0.2} /><stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fill:'#333',fontSize:9,fontFamily:'var(--font-geist-mono)' }} tickLine={false} axisLine={false} interval={3} />
          <YAxis tick={{ fill:'#333',fontSize:9,fontFamily:'var(--font-geist-mono)' }} tickLine={false} axisLine={false} />
          <Tooltip content={<TTip />} />
          <ReferenceLine y={targetCalories} stroke={`${C.calorie}22`} strokeDasharray="4 4" />
          {isSimulating && data[displayHour] && <ReferenceLine x={data[displayHour].label} stroke={C.sleep} strokeDasharray="3 3" />}
          <Area type="monotone" dataKey="target"    name={t.chartTarget}    stroke={C.calorie}  strokeWidth={1} strokeDasharray="4 4" fill="url(#gT)" dot={false} connectNulls />
          <Area type="monotone" dataKey="actual"    name={t.chartActual}    stroke={lineColor}  strokeWidth={2}   fill="url(#gA)" dot={false} connectNulls={false} style={{ filter:`drop-shadow(0 0 4px ${lineColor})` }} />
          <Area type="monotone" dataKey="projected" name={t.chartProjected} stroke={lineColor}  strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.4} fill="none" dot={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between" style={{ fontFamily:'var(--font-geist-mono)' }}>
          <span className="text-[9px]" style={{ color:C.calorie }}>{t.timeTravelLabel}</span>
          {isSimulating
            ? <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => { onSimHour(null); playClick() }}
                className="px-2 py-1 rounded-lg text-[9px] font-bold"
                style={{ background:`${C.calorie}15`, border:`0.5px solid ${C.calorie}66`, color:C.calorie, boxShadow:`0 0 10px ${C.calorie}33` }}>
                {t.backRealtime}
              </motion.button>
            : <span className="text-[9px] text-gray-600">{String(realHour).padStart(2,'0')}:00 · {t.liveMode}</span>
          }
        </div>
        <input type="range" min={0} max={23} step={1}
          value={simHour ?? realHour}
          onChange={e => { const h = parseInt(e.target.value); onSimHour(h===realHour ? null : h); playClick() }}
          className="cockpit-slider"
        />
        <div className="flex justify-between text-[8px] text-gray-700" style={{ fontFamily:'var(--font-geist-mono)' }}>
          {['00','06','12','18','23'].map(h => <span key={h}>{h}:00</span>)}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Weekly Efficiency Sparkline (refined) ──────────────────────────────────
function WeeklySparkline({ scores, t }: { scores: { date: string; score: number }[]; t: typeof translations['en'] }) {
  if (scores.length === 0) return null
  const avg = Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length)
  const avgColor = avg >= 70 ? C.calorie : avg >= 40 ? '#fbbf24' : '#f87171'
  return (
    <motion.div variants={panelVariants} className="rounded-2xl p-5 w-full nx-glass nx-sparkline">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full" style={{ background: C.calorie, boxShadow: `0 0 8px ${C.calorie}` }} />
          <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color: C.calorie, fontFamily: 'var(--font-geist-mono)' }}>
            {t.weeklyEfficiencyTitle}
          </span>
        </div>
        <span className="text-[10px] font-bold" style={{ color: avgColor, fontFamily: 'var(--font-geist-mono)' }}>
          {t.weeklyAvgLabel} <AnimatedCounter value={avg} color={avgColor} suffix="%" />
        </span>
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={scores} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.calorie} stopOpacity={0.15} />
              <stop offset="100%" stopColor={C.calorie} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fill: '#333', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: '#333', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: 'rgba(8,12,20,0.9)', border: `0.5px solid ${C.border}`, fontFamily: 'var(--font-geist-mono)', fontSize: 10, borderRadius: 12, backdropFilter: 'blur(12px)' }}
            labelStyle={{ color: '#555' }}
            formatter={(value: number | string | undefined) => [`${value ?? 0}%`, 'SYS_EFF']}
          />
          <ReferenceLine y={70} stroke={`${C.calorie}22`} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="score" name="SYS_EFF" stroke={C.calorie} strokeWidth={2}
            dot={{ r: 3, fill: C.calorie, stroke: C.calorie, strokeWidth: 1 }}
            activeDot={{ r: 5, fill: C.calorie, stroke: '#fff', strokeWidth: 1 }}
            style={{ filter: `drop-shadow(0 0 4px ${C.calorie})` }}
          />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  )
}

// ─── News Ticker ─────────────────────────────────────────────────────────────
function NewsTicker({ leaderboard, t }: { leaderboard: LeaderboardEntry[]; t: typeof translations['en'] }) {
  const count  = leaderboard.length
  const avgEff = count > 0 ? Math.round(leaderboard.reduce((s, e) => s + e.score, 0) / count) : 0
  const top    = count > 0 ? leaderboard[0].score : 0
  const items = [
    `${t.tickerGlobalEff}: ${avgEff}%`,
    `${t.tickerActiveOps}: ${count}`,
    t.tickerSystemStable,
    `${t.tickerTopScore}: ${top}%`,
    'NEXUS V1.9',
  ]
  const text = items.join('  ///  ')
  return (
    <div className="overflow-hidden" style={{ background: 'rgba(3,6,8,0.9)', borderBottom: `0.5px solid ${C.border}`, height: '24px' }}>
      <div className="nexus-ticker text-[9px] font-bold tracking-[0.15em] uppercase leading-[24px]"
        style={{ color: `${C.calorie}66`, fontFamily: 'var(--font-geist-mono)' }}>
        <span>{text}</span>
        <span className="ml-16">{text}</span>
      </div>
    </div>
  )
}

// ─── Squad Status Panel ──────────────────────────────────────────────────────
function SquadStatusPanel({ entries, open, onClose, currentUserId, t }: {
  entries: LeaderboardEntry[]; open: boolean; onClose: () => void; currentUserId: string; t: typeof translations['en']
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" exit="exit"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div variants={slideOverVariants} initial="hidden" animate="visible" exit="exit"
            className="relative w-full max-w-sm h-full overflow-y-auto nx-glass-strong"
            style={{ borderLeft: `0.5px solid ${C.borderStrong}` }}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3"
              style={{ background: C.panelSolid, borderBottom: `0.5px solid ${C.border}` }}>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" style={{ color: C.calorie, filter: `drop-shadow(0 0 4px ${C.calorie}88)` }} />
                <span className="text-[10px] font-black tracking-[0.25em] uppercase"
                  style={{ color: C.calorie, fontFamily: 'var(--font-geist-mono)' }}>{t.squadTitle}</span>
              </div>
              <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
                <X className="w-4 h-4 text-gray-500" />
              </motion.button>
            </div>
            <motion.div className="px-4 py-3 space-y-2" variants={staggerContainer} initial="hidden" animate="visible">
              {entries.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-8 h-8 mx-auto mb-2" style={{ color: '#333' }} />
                  <span className="text-[10px] text-gray-600" style={{ fontFamily: 'var(--font-geist-mono)' }}>{t.squadEmpty}</span>
                </div>
              ) : entries.map((entry, idx) => {
                const isMe = entry.userId === currentUserId
                const rankColor = idx === 0 ? '#ffd700' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#555'
                const scoreColor = entry.score >= 70 ? C.calorie : entry.score >= 40 ? '#fbbf24' : '#f87171'
                const goalLabel = entry.goal === 'loss' ? t.goalLoss : entry.goal === 'gain' ? t.goalGain : t.goalMaintain
                return (
                  <motion.div key={entry.userId} variants={panelVariants}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{
                      background: isMe ? `${C.calorie}06` : C.panel,
                      border: `0.5px solid ${isMe ? C.calorie + '33' : C.border}`,
                      boxShadow: isMe ? `0 0 16px ${C.calorie}10` : 'none',
                    }}>
                    <span className="text-sm font-black w-6 text-center" style={{ color: rankColor, fontFamily: 'var(--font-geist-mono)' }}>
                      {idx < 3 ? ['I', 'II', 'III'][idx] : `${idx + 1}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold truncate" style={{ color: isMe ? C.calorie : '#aaa', fontFamily: 'var(--font-geist-mono)' }}>
                        {isMe ? t.squadYou : `OP-${entry.userId.slice(0, 6).toUpperCase()}`}
                      </div>
                      <div className="text-[9px] text-gray-600" style={{ fontFamily: 'var(--font-geist-mono)' }}>{goalLabel}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black tabular-nums" style={{ color: scoreColor, textShadow: `0 0 8px ${scoreColor}66` }}>
                        {entry.score}%
                      </div>
                      <div className="text-[8px] text-gray-600" style={{ fontFamily: 'var(--font-geist-mono)' }}>SYS_EFF</div>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── Weekly Tactical Report ──────────────────────────────────────────────────

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff); d.setHours(0, 0, 0, 0)
  return d
}

interface WeeklyReportData {
  thisWeekAvg: number; lastWeekAvg: number
  thisWeekCal: number; lastWeekCal: number
  thisWeekHyd: number; lastWeekHyd: number
  thisWeekSleep: number; lastWeekSleep: number
}

function computeWeeklyReport(
  twoWeeks: { date: string; log: DailyLog }[],
  targetCalories: number,
): WeeklyReportData | null {
  if (twoWeeks.length === 0) return null
  const mondayStr = getMondayOfWeek(new Date()).toISOString().slice(0, 10)
  const thisWeek: DailyLog[] = []
  const lastWeek: DailyLog[] = []
  for (const { date, log } of twoWeeks) {
    if (date >= mondayStr) thisWeek.push(log)
    else lastWeek.push(log)
  }
  if (thisWeek.length === 0 && lastWeek.length === 0) return null

  function avgCalScore(logs: DailyLog[]): number {
    if (logs.length === 0) return 0
    return Math.round(logs.reduce((s, d) => {
      const diff = Math.abs(targetCalories - (d.caloriesIn - d.caloriesOut))
      return s + (diff <= 100 ? 40 : diff <= 300 ? 30 : diff <= 500 ? 15 : 0)
    }, 0) / logs.length)
  }
  function avgHydScore(logs: DailyLog[]): number {
    if (logs.length === 0) return 0
    return Math.round(logs.reduce((s, d) =>
      s + (d.waterMl >= 2000 ? 20 : d.waterMl >= 1500 ? 12 : d.waterMl >= 1000 ? 5 : 0)
    , 0) / logs.length)
  }
  function avgSleepScore(logs: DailyLog[]): number {
    if (logs.length === 0) return 0
    return Math.round(logs.reduce((s, d) =>
      s + (d.sleepHours >= 7 && d.sleepHours <= 9 ? 20 : d.sleepHours >= 6 ? 10 : d.sleepHours > 0 ? 3 : 0)
    , 0) / logs.length)
  }

  const twAvg = thisWeek.length > 0
    ? Math.round(thisWeek.reduce((s, d) => s + calculateDayScore(d, targetCalories), 0) / thisWeek.length) : 0
  const lwAvg = lastWeek.length > 0
    ? Math.round(lastWeek.reduce((s, d) => s + calculateDayScore(d, targetCalories), 0) / lastWeek.length) : 0

  return {
    thisWeekAvg: twAvg, lastWeekAvg: lwAvg,
    thisWeekCal: avgCalScore(thisWeek), lastWeekCal: avgCalScore(lastWeek),
    thisWeekHyd: avgHydScore(thisWeek), lastWeekHyd: avgHydScore(lastWeek),
    thisWeekSleep: avgSleepScore(thisWeek), lastWeekSleep: avgSleepScore(lastWeek),
  }
}

function WeeklyReportModal({ report, open, onClose, t }: {
  report: WeeklyReportData | null; open: boolean; onClose: () => void; t: typeof translations['en']
}) {
  return (
    <AnimatePresence>
      {open && report && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" exit="exit"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div variants={modalVariants} initial="hidden" animate="visible" exit="exit"
            className="relative w-full max-w-md mx-4 rounded-2xl overflow-hidden nx-glass-strong">
            {(() => {
              const diff = report.thisWeekAvg - report.lastWeekAvg
              const pct = Math.abs(diff)
              const statusMsg = diff > 2 ? interp(t.reportImproving, { pct }) : diff < -2 ? interp(t.reportDeclining, { pct }) : t.reportStable
              const statusColor = diff > 2 ? C.calorie : diff < -2 ? '#f87171' : '#fbbf24'
              const bars = [
                { label: t.reportCalBar, thisW: report.thisWeekCal, lastW: report.lastWeekCal, max: 40, color: C.calorie },
                { label: t.reportHydBar, thisW: report.thisWeekHyd, lastW: report.lastWeekHyd, max: 20, color: C.water },
                { label: t.reportSleepBar, thisW: report.thisWeekSleep, lastW: report.lastWeekSleep, max: 20, color: C.sleep },
              ]
              return (
                <>
                  <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `0.5px solid ${C.border}` }}>
                    <div className="flex items-center gap-2">
                      <FileBarChart className="w-4 h-4" style={{ color: C.calorie, filter: `drop-shadow(0 0 4px ${C.calorie}88)` }} />
                      <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color: C.calorie, fontFamily: 'var(--font-geist-mono)' }}>{t.reportTitle}</span>
                    </div>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"><X className="w-4 h-4 text-gray-500" /></motion.button>
                  </div>
                  <div className="px-5 py-4 space-y-4">
                    <div className="flex items-center gap-4">
                      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.1, ...springConfig }}
                        className="flex-1 text-center rounded-2xl p-3 nx-glass" style={{ borderColor: `${C.calorie}15` }}>
                        <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: C.calorie, fontFamily: 'var(--font-geist-mono)' }}>{t.reportThisWeek}</div>
                        <div className="text-2xl font-black tabular-nums" style={{ color: C.calorie, textShadow: `0 0 16px ${C.calorie}66` }}>
                          <AnimatedCounter value={report.thisWeekAvg} color={C.calorie} suffix="%" />
                        </div>
                      </motion.div>
                      <span className="text-gray-600 text-xs font-bold">VS</span>
                      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.15, ...springConfig }}
                        className="flex-1 text-center rounded-2xl p-3 nx-glass" style={{ borderColor: '#22222244' }}>
                        <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: '#888', fontFamily: 'var(--font-geist-mono)' }}>{t.reportLastWeek}</div>
                        <div className="text-2xl font-black tabular-nums text-gray-400">{report.lastWeekAvg}%</div>
                      </motion.div>
                    </div>
                    <div className="rounded-xl px-3 py-2" style={{ background: `${statusColor}06`, border: `0.5px solid ${statusColor}18` }}>
                      <span className="text-xs leading-snug" style={{ color: statusColor, fontFamily: 'var(--font-geist-mono)' }}>{statusMsg}</span>
                    </div>
                    {bars.map((bar, idx) => (
                      <motion.div key={bar.label} className="space-y-1"
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 + idx * 0.05, type: 'spring', stiffness: 200, damping: 24 }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: bar.color, fontFamily: 'var(--font-geist-mono)' }}>{bar.label}</span>
                          <span className="text-[9px] text-gray-600" style={{ fontFamily: 'var(--font-geist-mono)' }}>{bar.thisW}/{bar.max} vs {bar.lastW}/{bar.max}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: '#111' }}>
                            <motion.div className="h-full rounded-full"
                              initial={{ width: 0 }} animate={{ width: `${(bar.thisW / bar.max) * 100}%` }}
                              transition={{ type: 'spring', stiffness: 80, damping: 18, delay: 0.3 + idx * 0.05 }}
                              style={{ background: `linear-gradient(90deg, ${bar.color}88, ${bar.color})`, boxShadow: `0 0 8px ${bar.color}44` }} />
                          </div>
                          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: '#111' }}>
                            <motion.div className="h-full rounded-full opacity-30"
                              initial={{ width: 0 }} animate={{ width: `${(bar.lastW / bar.max) * 100}%` }}
                              transition={{ type: 'spring', stiffness: 80, damping: 18, delay: 0.35 + idx * 0.05 }}
                              style={{ background: bar.color }} />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                  <div className="px-5 py-3" style={{ borderTop: `0.5px solid ${C.border}` }}>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={onClose}
                      className="w-full rounded-xl py-2.5 text-[10px] font-bold tracking-widest uppercase"
                      style={{ background: `${C.calorie}08`, border: `0.5px solid ${C.calorie}33`, color: C.calorie, fontFamily: 'var(--font-geist-mono)' }}>
                      {t.reportDismiss}
                    </motion.button>
                  </div>
                </>
              )
            })()}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── Archive Panel (refined heatmap) ────────────────────────────────────────

function ArchivePanel({ weekData, monthlyData, open, onClose, onSelectDate, activeDate, targetCalories, t }: {
  weekData: { date: string; log: DailyLog }[]; monthlyData: { date: string; log: DailyLog }[]; open: boolean; onClose: () => void
  onSelectDate: (date: string | null) => void; activeDate: string | null
  targetCalories: number; t: typeof translations['en']
}) {
  const todayStr = new Date().toISOString().slice(0, 10)

  const heatmapCells = useMemo(() => {
    const cells: { date: string; score: number; hasData: boolean }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const ds = d.toISOString().slice(0, 10)
      const entry = monthlyData.find(m => m.date === ds)
      if (entry) {
        const isEmpty = entry.log.caloriesIn === 0 && entry.log.exerciseMinutes === 0 && entry.log.sleepHours === 0 && entry.log.waterMl === 0
        cells.push({ date: ds, score: isEmpty ? -1 : calculateDayScore(entry.log, targetCalories), hasData: !isEmpty })
      } else {
        cells.push({ date: ds, score: -1, hasData: false })
      }
    }
    return cells
  }, [monthlyData, targetCalories])

  function heatColor(score: number, hasData: boolean): string {
    if (!hasData) return 'rgba(26,26,26,0.4)'
    if (score > 70) return C.calorie
    if (score >= 40) return '#fbbf24'
    return '#f87171'
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" exit="exit"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div variants={slideOverVariants} initial="hidden" animate="visible" exit="exit"
            className="relative w-full max-w-sm h-full overflow-y-auto nx-glass-strong"
            style={{ borderLeft: `0.5px solid ${C.borderStrong}` }}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3" style={{ background: C.panelSolid, borderBottom: `0.5px solid ${C.border}` }}>
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4" style={{ color: C.sleep, filter: `drop-shadow(0 0 4px ${C.sleep}88)` }} />
                <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color: C.sleep, fontFamily: 'var(--font-geist-mono)' }}>{t.archiveTitle}</span>
              </div>
              <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"><X className="w-4 h-4 text-gray-500" /></motion.button>
            </div>

            {/* Refined 30-day Heatmap */}
            <div className="px-4 pt-4 pb-2">
              <div className="text-[9px] font-bold tracking-[0.2em] uppercase mb-3" style={{ color: C.sleep, fontFamily: 'var(--font-geist-mono)' }}>{t.heatmapTitle}</div>
              <div className="grid grid-cols-6 gap-2">
                {heatmapCells.map((cell, idx) => (
                  <motion.div key={cell.date}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.015, type: 'spring', stiffness: 300, damping: 20 }}
                    className="relative group nx-heat-cell"
                    title={`${cell.date.slice(5)} — ${cell.hasData ? cell.score + '%' : t.heatmapNoData}`}>
                    <div className="aspect-square rounded-md"
                      style={{
                        background: cell.hasData
                          ? `linear-gradient(135deg, ${heatColor(cell.score, cell.hasData)}88, ${heatColor(cell.score, cell.hasData)})`
                          : 'rgba(26,26,26,0.3)',
                        opacity: cell.hasData ? 0.85 : 0.2,
                        boxShadow: cell.hasData && cell.score > 70 ? `0 0 8px ${C.calorie}44, inset 0 1px 0 rgba(255,255,255,0.1)` : 'inset 0 1px 0 rgba(255,255,255,0.02)',
                      }} />
                    <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: '#fff', textShadow: '0 0 4px #000', fontFamily: 'var(--font-geist-mono)' }}>
                      {cell.date.slice(8)}
                    </span>
                  </motion.div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-3 mt-2">
                {[{ c: 'rgba(26,26,26,0.3)', l: '-' }, { c: '#f87171', l: '<40%' }, { c: '#fbbf24', l: '40-70%' }, { c: C.calorie, l: '>70%' }].map(leg => (
                  <div key={leg.l} className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: leg.c, opacity: leg.c.includes('26,26,26') ? 0.3 : 0.85 }} />
                    <span className="text-[7px] text-gray-600" style={{ fontFamily: 'var(--font-geist-mono)' }}>{leg.l}</span>
                  </div>
                ))}
              </div>
            </div>

            {activeDate && (
              <div className="px-4 pt-3">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => { onSelectDate(null); playClick() }}
                  className="w-full rounded-xl py-2.5 text-[10px] font-bold tracking-widest uppercase"
                  style={{ background: `${C.calorie}08`, border: `0.5px solid ${C.calorie}33`, color: C.calorie, fontFamily: 'var(--font-geist-mono)' }}>
                  {t.archiveLive}
                </motion.button>
              </div>
            )}
            <motion.div className="px-4 py-3 space-y-2" variants={staggerContainer} initial="hidden" animate="visible">
              {weekData.map(({ date, log: dl }) => {
                const score = calculateDayScore(dl, targetCalories)
                const isToday = date === todayStr
                const isActive = date === activeDate
                const isEmpty = dl.caloriesIn === 0 && dl.exerciseMinutes === 0 && dl.sleepHours === 0 && dl.waterMl === 0
                const scoreColor = score >= 70 ? C.calorie : score >= 40 ? '#fbbf24' : '#f87171'
                const calPct = Math.min((Math.max(0, dl.caloriesIn - dl.caloriesOut) / targetCalories) * 100, 100)
                const waterPct = Math.min((dl.waterMl / 2000) * 100, 100)
                const sleepPct = Math.min((dl.sleepHours / 8) * 100, 100)
                return (
                  <motion.button key={date} variants={panelVariants}
                    whileHover={!isToday ? { scale: 1.01, y: -1 } : {}} whileTap={!isToday ? { scale: 0.99 } : {}}
                    onClick={() => { if (!isToday) { onSelectDate(date); playClick() } }}
                    className="w-full text-left rounded-xl px-3 py-2.5"
                    style={{
                      background: isActive ? `${C.sleep}08` : C.panel,
                      border: `0.5px solid ${isActive ? C.sleep + '44' : isToday ? C.calorie + '22' : C.border}`,
                      cursor: isToday ? 'default' : 'pointer',
                      boxShadow: isActive ? `0 0 16px ${C.sleep}15` : 'none',
                    }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold" style={{ color: isToday ? C.calorie : '#ccc', fontFamily: 'var(--font-geist-mono)' }}>{date.slice(5)}</span>
                        {isToday && <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: `${C.calorie}12`, color: C.calorie, border: `0.5px solid ${C.calorie}22`, fontFamily: 'var(--font-geist-mono)' }}>{t.archiveToday}</span>}
                      </div>
                      <span className="text-sm font-black tabular-nums" style={{ color: isEmpty ? '#333' : scoreColor, fontFamily: 'var(--font-geist-mono)' }}>
                        {isEmpty ? t.archiveNoData : `${score}%`}
                      </span>
                    </div>
                    {!isEmpty && (
                      <div className="flex gap-1.5">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#111' }}><div className="h-full rounded-full" style={{ width: `${calPct}%`, background: `linear-gradient(90deg, ${C.calorie}88, ${C.calorie})` }} /></div>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#111' }}><div className="h-full rounded-full" style={{ width: `${waterPct}%`, background: `linear-gradient(90deg, ${C.water}88, ${C.water})` }} /></div>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#111' }}><div className="h-full rounded-full" style={{ width: `${sleepPct}%`, background: `linear-gradient(90deg, ${C.sleep}88, ${C.sleep})` }} /></div>
                      </div>
                    )}
                  </motion.button>
                )
              })}
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── Sticky Quick-Log bar ─────────────────────────────────────────────────────
type Tab = 'cal' | 'ex' | 'water' | 'sleep' | 'sys'

function StickyQuickLog({ log, ghostMode, locale, t, onPatch, onReset, foodFreq, onFoodLog, macros, onMacroSave, onMacroDelete, onMacroUse }: {
  log:DailyLog; ghostMode:boolean; locale:'en'|'cn'; t: typeof translations['en']
  onPatch:(d:Partial<DailyLog>,major?:boolean)=>void; onReset:()=>void
  foodFreq:Record<string,number>; onFoodLog:(f:FoodItem)=>void
  macros:TacticalMacro[]; onMacroSave:(m:TacticalMacro)=>void; onMacroDelete:(id:string)=>void; onMacroUse:(m:TacticalMacro)=>void
}) {
  const [tab, setTab] = useState<Tab>('cal')
  const [foodQuery, setFoodQuery] = useState('')
  const [showMacroForm, setShowMacroForm] = useState(false)
  const [macroName, setMacroName] = useState('')
  const [macroKcal, setMacroKcal] = useState('')
  const dis = ghostMode
  const results = foodQuery ? searchFood(foodQuery, locale) : []

  const topFavs = useMemo(() => {
    const entries = Object.entries(foodFreq).sort((a, b) => b[1] - a[1]).slice(0, 3)
    return entries.map(([id]) => FOOD_DB.find(f => f.id === id)).filter(Boolean) as FoodItem[]
  }, [foodFreq])

  const panels: Record<Tab, React.ReactNode> = {
    cal: <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
      {!foodQuery && topFavs.length > 0 && topFavs.map(f => (
        <motion.button key={`fav-${f.id}`} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => { if (!dis) onFoodLog(f) }}
          className="rounded-xl px-2.5 py-1.5 text-[9px] font-bold tracking-wide flex items-center gap-1"
          style={{ background:`${C.calorie}10`, border:`0.5px solid ${C.calorie}44`, color:C.calorie, fontFamily:'var(--font-geist-mono)' }}>
          <Zap className="w-2.5 h-2.5" />
          <span>{locale==='cn'?f.nameCn:f.name}</span>
          <span className="opacity-40">{f.kcal}</span>
        </motion.button>
      ))}
      {!foodQuery && macros.length > 0 && macros.map(m => (
        <motion.button key={`macro-${m.id}`} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => { if (!dis) onMacroUse(m) }}
          className="rounded-xl px-2.5 py-1.5 text-[9px] font-bold tracking-wide flex items-center gap-1 group"
          style={{ background:'#fb923c0a', border:'0.5px solid #fb923c44', color:'#fb923c', fontFamily:'var(--font-geist-mono)' }}>
          <Flame className="w-2.5 h-2.5" />
          <span>{m.name}</span>
          <span className="opacity-40">{m.kcal}</span>
          <span onClick={e => { e.stopPropagation(); onMacroDelete(m.id) }}
            className="opacity-0 group-hover:opacity-70 ml-0.5 hover:opacity-100 transition-opacity cursor-pointer">
            <Trash2 className="w-2.5 h-2.5" />
          </span>
        </motion.button>
      ))}
      {!foodQuery && (
        showMacroForm ? (
          <div className="flex items-center gap-1.5">
            <input value={macroName} onChange={e => setMacroName(e.target.value)}
              placeholder={t.macroNamePlaceholder}
              className="bg-transparent border rounded-lg px-2 py-1 text-[10px] text-white placeholder-gray-600 w-16 focus:outline-none"
              style={{ borderColor:'#fb923c33', fontFamily:'var(--font-geist-mono)' }} />
            <input value={macroKcal} onChange={e => setMacroKcal(e.target.value.replace(/\D/g, ''))}
              placeholder={t.macroKcalPlaceholder} type="text" inputMode="numeric"
              className="bg-transparent border rounded-lg px-2 py-1 text-[10px] text-white placeholder-gray-600 w-14 focus:outline-none"
              style={{ borderColor:'#fb923c33', fontFamily:'var(--font-geist-mono)' }} />
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => {
                const k = parseInt(macroKcal)
                if (macroName.trim() && k > 0) {
                  onMacroSave({ id: Date.now().toString(36), name: macroName.trim(), kcal: k })
                  setMacroName(''); setMacroKcal(''); setShowMacroForm(false)
                }
              }}
              className="rounded-lg px-2 py-1 text-[9px] font-bold"
              style={{ background:'#fb923c12', border:'0.5px solid #fb923c44', color:'#fb923c', fontFamily:'var(--font-geist-mono)' }}>
              {t.macroSave}
            </motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => { setShowMacroForm(false); setMacroName(''); setMacroKcal('') }}
              className="text-gray-600 hover:text-gray-400 transition-colors"><X className="w-3 h-3" /></motion.button>
          </div>
        ) : (
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={() => setShowMacroForm(true)}
            className="rounded-xl px-2 py-1 text-[9px] font-bold tracking-wide"
            style={{ background:'#fb923c06', border:'0.5px dashed #fb923c33', color:'#fb923c66', fontFamily:'var(--font-geist-mono)' }}>
            <Plus className="w-3 h-3 inline -mt-px" /> {t.macroTitle}
          </motion.button>
        )
      )}
      <div className="relative flex-1 min-w-[140px] max-w-[220px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 pointer-events-none" />
        <input value={foodQuery} onChange={e => setFoodQuery(e.target.value)}
          placeholder={t.foodSearchPlaceholder}
          className="w-full bg-transparent border rounded-xl pl-7 pr-2 py-1.5 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-[#39ff1466]"
          style={{ borderColor:`${C.calorie}22`, fontFamily:'var(--font-geist-mono)', transition: 'border-color 0.2s' }} />
      </div>
      {foodQuery ? (
        results.length > 0 ? results.map((f: FoodItem) => (
          <motion.button key={f.id} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={() => { if (!dis) { onFoodLog(f); setFoodQuery('') } }}
            className="rounded-xl px-2 py-1.5 text-[10px] font-bold tracking-wide flex items-center gap-1.5"
            style={{ background:`${C.calorie}08`, border:`0.5px solid ${C.calorie}33`, color:C.calorie, fontFamily:'var(--font-geist-mono)' }}>
            <span>{locale==='cn'?f.nameCn:f.name}</span>
            <span className="opacity-50">{f.kcal}</span>
          </motion.button>
        )) : <span className="text-[10px] text-gray-600" style={{ fontFamily:'var(--font-geist-mono)' }}>{t.foodSearchEmpty}</span>
      ) : <>
        <LogBtn label="+300 kcal" color={C.calorie} onClick={() => !dis && onPatch({ caloriesIn: 300 }, true)} />
        <LogBtn label="+500 kcal" color={C.calorie} onClick={() => !dis && onPatch({ caloriesIn: 500 }, true)} />
        <LogBtn label="+800 kcal" color={C.calorie} onClick={() => !dis && onPatch({ caloriesIn: 800 }, true)} />
        <LogBtn label={'\u2212300 kcal'} color="#f87171"   onClick={() => !dis && onPatch({ caloriesIn: -300 })} />
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
      <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        onClick={() => { if (!dis){ onReset(); playClick() } }} disabled={dis}
        className="flex items-center gap-1.5 text-[10px] text-gray-600 hover:text-gray-400 disabled:opacity-30 transition-colors ml-2"
        style={{ fontFamily:'var(--font-geist-mono)' }}>
        <RotateCcw className="w-3 h-3" /> {t.resetBtn}
      </motion.button>
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
    <div className="fixed bottom-0 left-0 right-0 z-30 nx-glass-strong" style={{ borderTop:`0.5px solid ${C.borderStrong}` }}>
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap min-h-[48px]" style={{ borderBottom:'0.5px solid rgba(26,26,26,0.8)' }}>
        {dis
          ? <span className="text-[10px] text-gray-600" style={{ fontFamily:'var(--font-geist-mono)' }}>{t.readOnly}</span>
          : panels[tab]
        }
      </div>
      <div className="flex">
        {tabs.map(tb => {
          const active = tab === tb.id
          return (
            <motion.button key={tb.id} whileTap={{ scale: 0.92 }}
              onClick={() => { setTab(tb.id); playClick() }}
              className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors"
              style={{ color:active?tb.color:'#444', borderTop:`2px solid ${active?tb.color:'transparent'}` }}>
              <tb.Icon className="w-4 h-4" style={{ filter: active ? `drop-shadow(0 0 4px ${tb.color}88)` : 'none' }} />
              <span className="text-[9px] font-bold" style={{ fontFamily:'var(--font-geist-mono)' }}>{tb.label}</span>
            </motion.button>
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
  const [simHour,         setSimHour]         = useState<number | null>(null)
  const [pulseRings,      setPulseRings]      = useState(false)
  const [hydrated,        setHydrated]        = useState(false)
  const [syncStatus,      setSyncStatus]      = useState<SyncStatus>('idle')
  const [shareGenerating, setShareGenerating] = useState(false)
  const [execScore,       setExecScore]       = useState<number | null>(null)
  const [weeklyScores,    setWeeklyScores]    = useState<{ date: string; score: number }[]>([])
  const [leaderboard,     setLeaderboard]     = useState<LeaderboardEntry[]>([])
  const [squadOpen,       setSquadOpen]       = useState(false)
  const [foodFreq,        setFoodFreq]        = useState<Record<string, number>>({})
  const [stabilityPct,    setStabilityPct]    = useState<number | null>(null)
  const [ghostDate,       setGhostDate]       = useState<string | null>(null)
  const [ghostLog,        setGhostLog]        = useState<DailyLog | null>(null)
  const [archiveOpen,     setArchiveOpen]     = useState(false)
  const [weekData,        setWeekData]        = useState<{ date: string; log: DailyLog }[]>([])
  const [reportOpen,      setReportOpen]      = useState(false)
  const [weeklyReport,    setWeeklyReport]    = useState<WeeklyReportData | null>(null)
  const [macros,          setMacros]          = useState<TacticalMacro[]>([])
  const [envTemp,         setEnvTemp]         = useState<number>(25)
  const [monthlyData,     setMonthlyData]     = useState<{ date: string; log: DailyLog }[]>([])
  const prevMissionCritRef = useRef(false)
  const snapshotRef = useRef<HTMLDivElement>(null)
  const ghostMode = ghostDate !== null

  // ── Parallax background ──
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const bgX = useTransform(mouseX, [0, 1], [-8, 8])
  const bgY = useTransform(mouseY, [0, 1], [-6, 6])
  const smoothBgX = useSpring(bgX, { stiffness: 50, damping: 20 })
  const smoothBgY = useSpring(bgY, { stiffness: 50, damping: 20 })

  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 768px)').matches
    if (isMobile) return
    function handleMouse(e: MouseEvent) {
      mouseX.set(e.clientX / window.innerWidth)
      mouseY.set(e.clientY / window.innerHeight)
    }
    window.addEventListener('mousemove', handleMouse, { passive: true })
    return () => window.removeEventListener('mousemove', handleMouse)
  }, [mouseX, mouseY])

  useEffect(() => {
    async function init() {
      const profile = await cloudLoadProfile()
      if (!profile) { router.push('/profile'); return }
      const dailyLog = await cloudLoadDailyLog()
      setData(profile)
      setLog(dailyLog)
      setHydrated(true)
      const recent = await cloudLoadRecentLogs(3)
      if (recent.length > 0) {
        setExecScore(calculateExecutionScore(recent, profile.metrics.targetCalories))
      }
      const twoWeeks = await cloudLoadRecentLogsWithDates(14)
      const weekly = twoWeeks.slice(0, 7)
      setWeekData(weekly)
      if (weekly.length > 0) {
        setWeeklyScores(weekly.map(({ date, log: dl }) => ({
          date: date.slice(5),
          score: calculateDayScore(dl, profile.metrics.targetCalories),
        })).reverse())
      }
      const report = computeWeeklyReport(twoWeeks, profile.metrics.targetCalories)
      setWeeklyReport(report)
      const currentWeek = getISOWeekNumber(new Date())
      const lastReportWeek = localStorage.getItem('nexus_last_report_week')
      if (lastReportWeek !== String(currentWeek) && report) {
        setReportOpen(true)
        localStorage.setItem('nexus_last_report_week', String(currentWeek))
      }
      const lb = await cloudLoadLeaderboard()
      setLeaderboard(lb)
      setFoodFreq(loadFoodFrequency())
      setMacros(loadMacros())
      setEnvTemp(getCurrentTemp())
      const monthly = await cloudLoadRecentLogsWithDates(30)
      setMonthlyData(monthly)
      if (monthly.length > 0) {
        const goodDays = monthly.filter(({ log: dl }) =>
          calculateDayScore(dl, profile.metrics.targetCalories) >= 70
        ).length
        setStabilityPct(Math.round((goodDays / monthly.length) * 100))
      }
    }
    init()
    const unsub = onSyncChange(setSyncStatus)
    return unsub
  }, [router])

  useEffect(() => {
    if (!hydrated || !data) return
    const dl = ghostDate !== null ? (ghostLog ?? FALLBACK_YESTERDAY) : log
    const wt = calculateWaterTarget(dl.exerciseMinutes)
    const crit = getMission(dl, data.metrics.targetCalories, t, wt).critical
    if (crit && !prevMissionCritRef.current) playCriticalAlert()
    prevMissionCritRef.current = crit
  }, [hydrated, data, log, ghostDate, ghostLog, t])

  const patch = useCallback((delta: Partial<DailyLog>, major = false) => {
    playClick(major)
    cloudPatchDailyLog(delta).then(next => setLog(next))
    if (major) { setPulseRings(true); setTimeout(() => setPulseRings(false), 800) }
  }, [])

  const handleFoodLog = useCallback((food: FoodItem) => {
    playClick(true)
    cloudPatchDailyLog({ caloriesIn: food.kcal }).then(next => setLog(next))
    setFoodFreq(bumpFoodFrequency(food.id))
    setPulseRings(true); setTimeout(() => setPulseRings(false), 800)
  }, [])
  const handleReset  = useCallback(() => { playClick(); cloudResetDailyLog().then(next => setLog(next)) }, [])
  const toggleLocale = useCallback(() => { playClick(); setLocale(locale === 'cn' ? 'en' : 'cn') }, [locale, setLocale])

  const handleMacroSave = useCallback((macro: TacticalMacro) => { playClick(); setMacros(saveMacro(macro)) }, [])
  const handleMacroDelete = useCallback((id: string) => { playClick(); setMacros(deleteMacro(id)) }, [])
  const handleMacroUse = useCallback((macro: TacticalMacro) => {
    playClick(true)
    cloudPatchDailyLog({ caloriesIn: macro.kcal }).then(next => setLog(next))
    setPulseRings(true); setTimeout(() => setPulseRings(false), 800)
  }, [])

  const handleArchiveSelect = useCallback(async (date: string | null) => {
    if (date === null) { setGhostDate(null); setGhostLog(null); return }
    setGhostDate(date)
    const cached = weekData.find(w => w.date === date)
    if (cached) { setGhostLog(cached.log) }
    else { const loaded = await cloudLoadLogByDate(date); setGhostLog(loaded ?? { ...FALLBACK_YESTERDAY }) }
  }, [weekData])

  const handleShare = useCallback(async () => {
    if (!snapshotRef.current || shareGenerating) return
    playClick(true)
    setShareGenerating(true)
    try {
      const dataUrl = await toPng(snapshotRef.current, {
        backgroundColor: '#030608',
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

  const displayLog = ghostMode ? (ghostLog ?? FALLBACK_YESTERDAY) : log

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
      <div className="min-h-screen flex items-center justify-center" style={{ background:'#030608' }}>
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="flex items-center gap-3">
          <Zap className="w-5 h-5 animate-pulse" style={{ color:C.calorie, filter:`drop-shadow(0 0 8px ${C.calorie})` }} />
          <span className="text-sm uppercase tracking-[0.3em] text-gray-400" style={{ fontFamily:'var(--font-geist-mono)' }}>INITIALISING...</span>
        </motion.div>
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
  const waterTarget = calculateWaterTarget(activeLog.exerciseMinutes, envTemp)
  const insights = runEngine(activeLog, metrics.targetCalories, metrics.bmr, t, waterTarget)
  const hasAlert     = insights.some(i => i.level === 'alert')
  const missionResult = getMission(activeLog, metrics.targetCalories, t, waterTarget)
  const mission       = missionResult.text
  const missionCrit   = missionResult.critical
  const dateStr  = new Date().toLocaleDateString(locale==='cn' ? 'zh-CN' : 'en-US', { weekday:'short', month:'short', day:'numeric' })

  const _locale: Locale = locale

  return (
    <div className="min-h-screen text-white pb-36 nexus-scanline" style={{ background:'#030608' }}>

      {/* ── Parallax Background ── */}
      <motion.div className="nx-parallax-bg"
        style={{ x: smoothBgX, y: smoothBgY }} />

      {/* ── News Ticker ── */}
      <NewsTicker leaderboard={leaderboard} t={t} />

      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 nx-glass-strong"
        style={{ borderBottom:`0.5px solid ${C.borderStrong}` }}>
        <div className="flex items-center gap-3 min-w-0">
          <motion.div whileHover={{ scale: 1.08, rotate: 3 }} whileTap={{ scale: 0.95 }}
            className="w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center"
            style={{ background:`${C.calorie}10`, border:`0.5px solid ${C.calorie}33`, boxShadow: `0 0 20px ${C.calorie}15, inset 0 1px 0 rgba(255,255,255,0.05)` }}>
            <Zap className="w-4.5 h-4.5" style={{ color:C.calorie, filter:`drop-shadow(0 0 6px ${C.calorie})` }} />
          </motion.div>
          <div className="min-w-0">
            <div className="text-xs font-black tracking-[0.2em] uppercase" style={{ color:C.calorie, textShadow:`0 0 12px ${C.calorie}55`, fontFamily:'var(--font-geist-sans)' }}>Nexus Health</div>
            <div className="text-[9px] truncate flex items-center gap-2" style={{ fontFamily:'var(--font-geist-mono)', color:'#555' }}>
              {t.missionPrefix} <span className={missionCrit ? 'nexus-critical-glow' : ''} style={{ color:missionCrit?'#f87171':hasAlert?'#f87171':C.calorie }}>{mission}</span>
              {execScore !== null && (
                <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black"
                  style={{
                    background: execScore >= 70 ? `${C.calorie}10` : execScore >= 40 ? '#fbbf2410' : '#f8717110',
                    color: execScore >= 70 ? C.calorie : execScore >= 40 ? '#fbbf24' : '#f87171',
                    border: `0.5px solid ${execScore >= 70 ? C.calorie : execScore >= 40 ? '#fbbf24' : '#f87171'}22`,
                    textShadow: `0 0 6px ${execScore >= 70 ? C.calorie : execScore >= 40 ? '#fbbf24' : '#f87171'}66`,
                    fontFamily: 'var(--font-geist-mono)',
                  }}>
                  {t.execScoreLabel} <AnimatedCounter value={execScore} suffix="%" />
                </motion.span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <motion.button whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.95 }}
            onClick={handleShare} disabled={shareGenerating}
            className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold tracking-widest uppercase disabled:opacity-60 ${shareGenerating ? 'share-shimmer' : ''}`}
            style={{ background:`${C.calorie}08`, border:`0.5px solid ${C.calorie}33`, color:C.calorie, fontFamily:'var(--font-geist-mono)' }}>
            {shareGenerating ? <Download className="w-3 h-3 animate-pulse" /> : <Share2 className="w-3 h-3" />}
            {shareGenerating ? t.shareGenerating : t.shareBtn}
          </motion.button>
          <motion.button whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.95 }}
            onClick={() => { setReportOpen(true); playClick() }}
            className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold tracking-widest uppercase"
            style={{ background:`${C.calorie}08`, border:`0.5px solid ${C.calorie}33`, color:C.calorie, fontFamily:'var(--font-geist-mono)' }}>
            <FileBarChart className="w-3 h-3" />
            {t.reportBtn}
          </motion.button>
          <motion.button whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.95 }}
            onClick={() => { setSquadOpen(true); playClick() }}
            className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold tracking-widest uppercase"
            style={{ background:`${C.exercise}08`, border:`0.5px solid ${C.exercise}33`, color:C.exercise, fontFamily:'var(--font-geist-mono)' }}>
            <Users className="w-3 h-3" />
            {t.squadBtn}
          </motion.button>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={toggleLocale}
            className="px-2.5 py-1.5 rounded-xl text-[11px] font-black tracking-widest"
            style={{ background:`${C.exercise}10`, border:`0.5px solid ${C.exercise}33`, color:C.exercise, fontFamily:'var(--font-geist-mono)' }}>
            {_locale === 'cn' ? 'EN' : 'CN'}
          </motion.button>
          <motion.button whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.95 }}
            onClick={() => { setArchiveOpen(true); playClick() }}
            className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold tracking-widest uppercase"
            style={{ background:ghostMode?`${C.sleep}12`:'transparent', border:`0.5px solid ${ghostMode?C.sleep+'44':'#333'}`, color:ghostMode?C.sleep:'#444', fontFamily:'var(--font-geist-mono)', boxShadow:ghostMode?`0 0 12px ${C.sleep}33`:'none' }}>
            <Archive className="w-3 h-3" />
            {ghostMode ? ghostDate?.slice(5) : t.archiveBtn}
          </motion.button>
          <span className="text-[9px] text-gray-600 hidden sm:block" style={{ fontFamily:'var(--font-geist-mono)' }}>{dateStr}</span>
          <motion.button whileHover={{ scale: 1.1, rotate: 30 }} whileTap={{ scale: 0.9 }}
            onClick={() => router.push('/profile')} className="p-1.5 rounded-xl text-gray-600 hover:text-gray-300 transition-colors">
            <Settings className="w-4 h-4" />
          </motion.button>
        </div>
      </motion.header>

      {/* Archive ghost banner */}
      <AnimatePresence>
        {ghostMode && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="flex items-center justify-center gap-2 py-1.5 text-[10px] font-bold tracking-widest uppercase overflow-hidden"
            style={{ background:`${C.sleep}08`, borderBottom:`0.5px solid ${C.sleep}22`, color:C.sleep, fontFamily:'var(--font-geist-mono)' }}>
            <Archive className="w-3 h-3" /> {t.archiveTitle} — {ghostDate}
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => { setGhostDate(null); setGhostLog(null); playClick() }}
              className="ml-2 px-2 py-0.5 rounded-lg text-[9px]"
              style={{ background:`${C.calorie}12`, border:`0.5px solid ${C.calorie}66`, color:C.calorie }}>
              {t.archiveLive}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alert banner */}
      <AnimatePresence>
        {hasAlert && !ghostMode && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="nexus-glitch flex items-center justify-center gap-2 py-1.5 text-[10px] font-bold tracking-widest overflow-hidden"
            style={{ background:'rgba(248,113,113,0.05)', borderBottom:'0.5px solid rgba(248,113,113,0.15)', color:'#f87171', fontFamily:'var(--font-geist-mono)' }}>
            <AlertTriangle className="w-3 h-3" /> {t.alertBanner}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ghost: no data fallback */}
      {ghostMode && !ghostLog && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center gap-3 py-8 px-4" style={{ fontFamily:'var(--font-geist-mono)' }}>
          <Archive className="w-10 h-10" style={{ color:`${C.sleep}33` }} />
          <span className="text-sm font-bold tracking-widest uppercase" style={{ color:C.sleep }}>{t.archiveNoData}</span>
          <span className="text-[10px] text-gray-600 text-center max-w-xs">{t.ghostNoDataHint}</span>
        </motion.div>
      )}

      <motion.div ref={snapshotRef}
        variants={staggerContainer} initial="hidden" animate="visible"
        className="max-w-5xl mx-auto px-4 py-6 space-y-6 relative z-10">

        {/* Watermark */}
        <div className="flex items-center justify-between" style={{ fontFamily:'var(--font-geist-mono)' }}>
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3" style={{ color:C.calorie }} />
            <span className="text-[8px] font-black tracking-[0.3em] uppercase" style={{ color:`${C.calorie}44` }}>{t.shareWatermark}</span>
          </div>
          <span className="text-[8px] tracking-wider" style={{ color:'#222' }}>
            {new Date().toLocaleString(locale==='cn'?'zh-CN':'en-US')} · V1.9
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── LEFT: Rings ── */}
          <motion.div variants={panelVariants} className="flex flex-col items-center gap-5">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-[10px] font-bold tracking-[0.3em] uppercase text-gray-600" style={{ fontFamily:'var(--font-geist-mono)' }}>{t.dailyProgress}</h2>
              {ghostMode && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background:`${C.sleep}10`, color:C.sleep, border:`0.5px solid ${C.sleep}22`, fontFamily:'var(--font-geist-mono)' }}>{ghostDate?.slice(5)}</span>}
              {simHour !== null && <span className="text-[9px] px-2 py-0.5 rounded-full animate-pulse" style={{ background:`${C.calorie}10`, color:C.calorie, border:`0.5px solid ${C.calorie}33`, fontFamily:'var(--font-geist-mono)' }}>{t.simulating} {String(simHour).padStart(2,'0')}:00</span>}
            </div>

            {/* Rings with pulse wrapper + spring physics */}
            <motion.div className={pulseRings ? 'ring-pulse' : ''} animate={{ scale: 1 }} transition={springConfig}>
              <div className="relative w-[300px] h-[300px]">
                <svg width={300} height={300} viewBox="0 0 300 300" style={{ transform:'rotate(-90deg)' }}>
                  <Ring cx={150} cy={150} r={130} sw={14} pct={calPct}   color={calColor}   bgColor={C.calBg} />
                  <Ring cx={150} cy={150} r={100} sw={14} pct={exPct}    color={C.exercise} bgColor={C.exBg}  />
                  <Ring cx={150} cy={150} r={70}  sw={14} pct={sleepPct} color={C.sleep}    bgColor={C.slBg}  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-1" style={{ fontFamily:'var(--font-geist-mono)' }}>{ghostMode?t.yesterdayCenter:t.netIntake}</div>
                  <AnimatedCounter value={net} color={calColor} className="text-3xl font-black tabular-nums" />
                  <div className="text-[11px] text-gray-500" style={{ fontFamily:'var(--font-geist-mono)' }}>/ {metrics.targetCalories.toLocaleString()} kcal</div>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-2 text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                    style={{
                      background: balance>=0?`${C.calorie}10`:'#ff444410',
                      color: balance>=0?C.calorie:'#ff4444',
                      border: `0.5px solid ${balance>=0?C.calorie:'#ff4444'}22`,
                      fontFamily:'var(--font-geist-mono)',
                    }}>
                    {balance>=0 ? '\u25bc ' : '\u25b2 '}<AnimatedCounter value={Math.abs(balance)} /> {balance>=0 ? t.remaining : t.over}
                  </motion.div>
                </div>
              </div>
            </motion.div>

            {/* Legend */}
            <div className="flex items-center gap-5">
              {[
                { icon:<Flame    className="w-3.5 h-3.5" />, label:t.legendCalories, val:`${Math.round(calPct)}%`,          color:calColor   },
                { icon:<Activity className="w-3.5 h-3.5" />, label:t.legendExercise, val:`${activeLog.exerciseMinutes} min`, color:C.exercise },
                { icon:<Moon     className="w-3.5 h-3.5" />, label:t.legendSleep,    val:`${activeLog.sleepHours} h`,        color:C.sleep    },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span style={{ color:s.color, filter:`drop-shadow(0 0 3px ${s.color}88)` }}>{s.icon}</span>
                  <div>
                    <div className="font-semibold text-[11px]" style={{ color:s.color, fontFamily:'var(--font-geist-sans)' }}>{s.label}</div>
                    <div className="text-gray-500 text-[10px]" style={{ fontFamily:'var(--font-geist-mono)' }}>{s.val}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-stretch gap-3 w-full">
              <HydrationGauge waterMl={activeLog.waterMl} waterTarget={waterTarget} t={t} />
              <SystemClearLED done={activeLog.flushDone} t={t} />
            </div>

            <div className="grid grid-cols-3 gap-3 w-full">
              {[
                { label:t.bmrLabel,    value:metrics.bmr,            color:'#60a5fa' },
                { label:t.tdeeLabel,   value:metrics.tdee,           color:'#fb923c' },
                { label:t.targetLabel, value:metrics.targetCalories, color:C.calorie },
              ].map((s, idx) => (
                <motion.div key={s.label}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + idx * 0.06, type: 'spring', stiffness: 200, damping: 24 }}
                  className="rounded-2xl p-3 text-center nx-glass" style={{ borderColor:`${s.color}12` }}>
                  <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color:s.color, fontFamily:'var(--font-geist-mono)' }}>{s.label}</div>
                  <AnimatedCounter value={s.value} className="text-lg font-black tabular-nums" />
                  <div className="text-[9px] text-gray-600" style={{ fontFamily:'var(--font-geist-mono)' }}>kcal</div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* ── RIGHT: System Status ── */}
          <motion.div variants={panelVariants} className="flex flex-col gap-5">
            <div className="rounded-2xl p-5 nx-glass">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-4 rounded-full" style={{ background:C.calorie, boxShadow:`0 0 10px ${C.calorie}` }} />
                <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color:C.calorie, fontFamily:'var(--font-geist-mono)' }}>{t.systemStatusTitle}</span>
                {hasAlert && <span className="ml-auto text-[9px] animate-pulse" style={{ color:'#f87171', fontFamily:'var(--font-geist-mono)' }}>{t.alertDot}</span>}
              </div>
              <div className="space-y-2">
                {insights.map((ins, idx) => <InsightRow key={idx} i={ins} idx={idx} />)}
              </div>
              {/* Environmental Temperature */}
              <div className="mt-4 pt-3 flex items-center gap-3" style={{ borderTop:`0.5px solid ${C.border}` }}>
                {getWeatherIcon(envTemp) === 'sun'
                  ? <Sun className="w-4 h-4 flex-shrink-0" style={{ color:'#fb923c', filter:'drop-shadow(0 0 6px #fb923c88)' }} />
                  : <CloudSun className="w-4 h-4 flex-shrink-0" style={{ color:'#38bdf8', filter:'drop-shadow(0 0 6px #38bdf888)' }} />}
                <div className="flex-1">
                  <span className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: envTemp >= 30 ? '#fb923c' : '#38bdf8', fontFamily:'var(--font-geist-mono)' }}>
                    {t.envTempLabel}
                  </span>
                </div>
                <AnimatedCounter value={envTemp}
                  color={envTemp >= 30 ? '#fb923c' : '#38bdf8'}
                  className="text-sm font-black tabular-nums"
                  suffix={t.envTempUnit} />
              </div>
              {/* Cloud Sync LED */}
              <div className="mt-4 pt-3" style={{ borderTop:`0.5px solid ${C.border}` }}>
                <CloudSyncLED status={syncStatus} t={t} />
              </div>
              {/* Stability Index */}
              {stabilityPct !== null && (() => {
                const stR = 28, stSw = 5, stCirc = 2 * Math.PI * stR
                const stColor = stabilityPct >= 70 ? C.calorie : stabilityPct >= 40 ? '#fbbf24' : '#f87171'
                const isPulsing = stabilityPct > 90
                return (
                  <div className={`mt-4 pt-3 flex items-center gap-4 ${isPulsing ? 'stability-pulse' : ''}`} style={{ borderTop:`0.5px solid ${C.border}` }}>
                    <svg width={70} height={70} viewBox="0 0 70 70" style={{ transform:'rotate(-90deg)' }}>
                      <circle cx={35} cy={35} r={stR} fill="none" stroke="rgba(26,26,26,0.5)" strokeWidth={stSw} />
                      <motion.circle cx={35} cy={35} r={stR} fill="none" stroke={stColor} strokeWidth={stSw}
                        initial={{ strokeDashoffset: stCirc }}
                        animate={{ strokeDashoffset: stCirc * (1 - stabilityPct / 100) }}
                        transition={{ type: 'spring', stiffness: 60, damping: 18, delay: 0.4 }}
                        strokeDasharray={stCirc}
                        strokeLinecap="round"
                        style={{ filter:`drop-shadow(0 0 ${isPulsing ? '14px' : '8px'} ${stColor})` }} />
                    </svg>
                    <div>
                      <div className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color:stColor, fontFamily:'var(--font-geist-mono)' }}>
                        {t.stabilityTitle}
                      </div>
                      <AnimatedCounter value={stabilityPct} color={stColor}
                        className="text-lg font-black tabular-nums" suffix="%" />
                      <div className="text-[8px] text-gray-600" style={{ fontFamily:'var(--font-geist-mono)' }}>{t.stabilityHint}</div>
                    </div>
                  </div>
                )
              })()}
            </div>

            <motion.div variants={panelVariants}
              className="rounded-2xl px-4 py-3 flex items-center justify-between nx-glass">
              <span className="text-[9px] uppercase tracking-widest text-gray-600" style={{ fontFamily:'var(--font-geist-mono)' }}>{t.profileLabel}</span>
              <span className="text-[11px] text-gray-400 capitalize" style={{ fontFamily:'var(--font-geist-mono)' }}>
                {data.profile.gender} · {data.profile.age}y · {data.profile.weightKg}kg ·{' '}
                <span style={{ color:C.calorie }}>
                  {data.profile.goal==='loss' ? t.goalLoss : data.profile.goal==='gain' ? t.goalGain : t.goalMaintain}
                </span>
              </span>
            </motion.div>
          </motion.div>
        </div>

        {/* ── Energy Timeline ── */}
        <EnergyTrendChart
          net={net} targetCalories={metrics.targetCalories}
          ghostMode={ghostMode} simHour={simHour} onSimHour={setSimHour} t={t}
        />

        {/* ── Weekly Efficiency Sparkline ── */}
        <WeeklySparkline scores={weeklyScores} t={t} />
      </motion.div>

      {/* ── Sticky Quick Log ── */}
      <StickyQuickLog log={log} ghostMode={ghostMode} locale={locale} t={t} onPatch={patch} onReset={handleReset} foodFreq={foodFreq} onFoodLog={handleFoodLog}
        macros={macros} onMacroSave={handleMacroSave} onMacroDelete={handleMacroDelete} onMacroUse={handleMacroUse} />

      {/* ── Squad Status Panel ── */}
      <SquadStatusPanel
        entries={leaderboard} open={squadOpen}
        onClose={() => setSquadOpen(false)}
        currentUserId={getUserId()} t={t}
      />

      {/* ── Weekly Report Modal ── */}
      <WeeklyReportModal report={weeklyReport} open={reportOpen} onClose={() => setReportOpen(false)} t={t} />

      {/* ── Archive Panel ── */}
      <ArchivePanel
        weekData={weekData} monthlyData={monthlyData} open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onSelectDate={handleArchiveSelect}
        activeDate={ghostDate}
        targetCalories={metrics.targetCalories} t={t}
      />
    </div>
  )
}
