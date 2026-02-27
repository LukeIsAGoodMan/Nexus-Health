'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  Zap, Activity, Moon, Flame, AlertTriangle,
  CheckCircle2, Info, RotateCcw, Settings,
  Droplets, Ghost,
} from 'lucide-react'
import {
  loadProfile, loadDailyLog, patchDailyLog, resetDailyLog,
  type StoredProfile, type DailyLog,
} from '@/lib/local-store'
import { WATER_TARGET_ML } from '@/lib/health-engine'

// ─── Colour tokens ────────────────────────────────────────────────────────────
const C = {
  calorie:  '#39ff14',
  exercise: '#00d4ff',
  sleep:    '#bf80ff',
  water:    '#38bdf8',
  flush:    '#39ff14',
  calBg:    '#0a1a0a',
  exBg:     '#071520',
  slBg:     '#130a22',
  panel:    '#0a0d14',
  border:   'rgba(57,255,20,0.15)',
}

// ─── Mock yesterday ───────────────────────────────────────────────────────────
const MOCK_YESTERDAY: DailyLog = {
  caloriesIn:      1850,
  caloriesOut:     280,
  exerciseMinutes: 35,
  sleepHours:      6.5,
  waterMl:         1400,
  flushDone:       true,
}

// ─── Deterministic Rule Engine ────────────────────────────────────────────────
type InsightLevel = 'ok' | 'warn' | 'alert' | 'info'
interface Insight { level: InsightLevel; message: string }

function runRuleEngine(log: DailyLog, targetCalories: number, bmr: number): Insight[] {
  const hour    = new Date().getHours()
  const net     = log.caloriesIn - log.caloriesOut
  const balance = targetCalories - net
  const insights: Insight[] = []

  // — Calorie balance
  if (log.caloriesIn === 0) {
    insights.push({ level: 'info', message: '> AWAITING_INPUT  No calories logged. Begin tracking.' })
  } else if (balance > 700) {
    insights.push({ level: 'warn', message: `> DEFICIT_HIGH [${balance} kcal]  Consume 300 kcal snack to protect lean mass.` })
  } else if (balance < -300) {
    insights.push({ level: 'alert', message: `> SURPLUS_DETECTED [+${Math.abs(balance)} kcal]  Execute 20 min cardio protocol.` })
  } else {
    const rem = balance > 0 ? `${balance} kcal remaining.` : 'Target reached.'
    insights.push({ level: 'ok', message: `> CALORIE_BALANCE_OK  ${rem}` })
  }

  // — Burn-out Predictor
  if (log.caloriesIn > 0 && net > 0) {
    const burnRatePerHour = bmr / 24
    const fuelHoursLeft   = net / burnRatePerHour
    const depletionHour   = hour + fuelHoursLeft
    const dH = Math.floor(depletionHour % 24)
    const dM = Math.round((depletionHour % 1) * 60)
    const timeStr = `${String(dH).padStart(2, '0')}:${String(dM).padStart(2, '0')}`

    if (fuelHoursLeft < 1.5) {
      insights.push({ level: 'alert', message: '> ALERT: Metabolic crash imminent. Please refuel now.' })
    } else if (fuelHoursLeft < 3) {
      insights.push({ level: 'warn',  message: `> PREDICTION: Low fuel warning. Estimated exhaustion at ${timeStr}.` })
    } else {
      insights.push({ level: 'info',  message: `> PREDICTION: Estimated fuel exhaustion at ${timeStr}.` })
    }
  } else if (log.caloriesIn === 0) {
    insights.push({ level: 'alert', message: '> PREDICTION: No fuel detected. Metabolic crash risk active.' })
  }

  // — Late Night Guard
  if (hour >= 21 && net > targetCalories * 0.9) {
    insights.push({ level: 'alert', message: '> FUELING_CLOSED  System entering sleep mode. No further intake advised.' })
  }

  // — Exercise
  if (log.exerciseMinutes === 0) {
    insights.push({ level: 'warn', message: '> EXERCISE_DEFICIT  Minimum 30 min activity required today.' })
  } else if (log.exerciseMinutes >= 60) {
    insights.push({ level: 'ok',   message: `> HIGH_OUTPUT [${log.exerciseMinutes} min]  Recovery protocol now active.` })
  } else if (log.exerciseMinutes >= 30) {
    insights.push({ level: 'ok',   message: `> EXERCISE_GOAL_MET [${log.exerciseMinutes} min]  Well executed.` })
  } else {
    insights.push({ level: 'info', message: `> EXERCISE_IN_PROGRESS [${log.exerciseMinutes} min]  ${30 - log.exerciseMinutes} min to target.` })
  }

  // — Sleep
  if (log.sleepHours === 0) {
    insights.push({ level: 'info',  message: '> SLEEP_DATA_MISSING  Log recovery hours to enable analysis.' })
  } else if (log.sleepHours < 6) {
    insights.push({ level: 'alert', message: `> CRITICAL_SLEEP_DEFICIT [${log.sleepHours}h]  Performance severely compromised.` })
  } else if (log.sleepHours < 7) {
    insights.push({ level: 'warn',  message: `> SLEEP_SUBOPTIMAL [${log.sleepHours}h]  Target 7–9 h for full recovery.` })
  } else {
    insights.push({ level: 'ok',    message: `> RECOVERY_OPTIMAL [${log.sleepHours}h]  System fully restored.` })
  }

  // — Hydration
  if (hour >= 14 && log.waterMl < 1000) {
    insights.push({ level: 'alert', message: '> HIGH_DEHYDRATION_RISK  Immediate action: consume 500 ml now.' })
  } else if (log.waterMl >= WATER_TARGET_ML) {
    insights.push({ level: 'ok',    message: `> HYDRATION_OPTIMAL [${log.waterMl} ml]  Daily target achieved.` })
  } else {
    insights.push({ level: 'info',  message: `> HYDRATION [${log.waterMl} / ${WATER_TARGET_ML} ml]  ${WATER_TARGET_ML - log.waterMl} ml remaining.` })
  }

  // — Metabolic alert
  if (hour >= 18 && !log.flushDone) {
    insights.push({ level: 'warn', message: '> METABOLIC_SLUGGISHNESS  Bowel movement not logged. Increase fiber and water.' })
  }

  return insights
}

// ─── Energy Trend Chart ───────────────────────────────────────────────────────
interface TrendPoint { label: string; target: number; actual: number | undefined; projected: number | undefined }

function buildChartData(net: number, targetCalories: number, ghostMode: boolean): TrendPoint[] {
  const currentHour = ghostMode ? 24 : new Date().getHours()
  const rate        = currentHour > 0 ? net / currentHour : 0
  return Array.from({ length: 25 }, (_, h) => ({
    label:     `${String(h).padStart(2, '0')}:00`,
    target:    targetCalories,
    actual:    h <= currentHour ? Math.round(rate * h) : undefined,
    projected: h >= currentHour ? Math.round(net + rate * (h - currentHour)) : undefined,
  }))
}

interface TooltipProps { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }
function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: '#0d1420', border: `1px solid ${C.border}`, fontFamily: 'monospace' }}>
      <div className="text-gray-500 mb-1">{label}</div>
      {payload.map(p => p.value != null && (
        <div key={p.name} style={{ color: p.color }}>{p.name}: {p.value.toLocaleString()} kcal</div>
      ))}
    </div>
  )
}

function EnergyTrendChart({ net, targetCalories, ghostMode }: { net: number; targetCalories: number; ghostMode: boolean }) {
  const data       = buildChartData(net, targetCalories, ghostMode)
  const overBudget = net > targetCalories
  const lineColor  = overBudget ? '#ff4444' : C.exercise

  return (
    <div className="rounded-2xl p-5 w-full" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full" style={{ background: C.sleep, boxShadow: `0 0 8px ${C.sleep}` }} />
          <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color: C.sleep, fontFamily: 'monospace' }}>
            Energy_Timeline  {ghostMode && '— Yesterday'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[9px]" style={{ fontFamily: 'monospace' }}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-px" style={{ background: C.calorie, boxShadow: `0 0 4px ${C.calorie}` }} />
            <span style={{ color: C.calorie }}>Target</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5" style={{ background: lineColor }} />
            <span style={{ color: lineColor }}>Actual</span>
          </span>
          <span className="flex items-center gap-1.5 opacity-50">
            <span className="inline-block w-4 h-px" style={{ background: lineColor, borderTop: '1px dashed' }} />
            <span style={{ color: lineColor }}>Projected</span>
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradTarget" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.calorie} stopOpacity={0.12} />
              <stop offset="95%" stopColor={C.calorie} stopOpacity={0}    />
            </linearGradient>
            <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0}    />
            </linearGradient>
          </defs>

          <XAxis dataKey="label" tick={{ fill: '#444', fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval={3} />
          <YAxis tick={{ fill: '#444', fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={targetCalories} stroke={`${C.calorie}33`} strokeDasharray="4 4" />

          <Area type="monotone" dataKey="target"    name="Target"    stroke={C.calorie}  strokeWidth={1.5} strokeDasharray="4 4" fill="url(#gradTarget)" dot={false} connectNulls />
          <Area type="monotone" dataKey="actual"    name="Actual"    stroke={lineColor}  strokeWidth={2}   fill="url(#gradActual)" dot={false} connectNulls={false} style={{ filter: `drop-shadow(0 0 4px ${lineColor})` }} />
          <Area type="monotone" dataKey="projected" name="Projected" stroke={lineColor}  strokeWidth={1.5} strokeDasharray="3 3" strokeOpacity={0.4} fill="none" dot={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── SVG Ring ─────────────────────────────────────────────────────────────────
function Ring({ cx, cy, r, sw, pct, color, bgColor }: { cx: number; cy: number; r: number; sw: number; pct: number; color: string; bgColor: string }) {
  const circ    = 2 * Math.PI * r
  const clamped = Math.min(Math.max(pct, 0), 100)
  const offset  = circ * (1 - clamped / 100)
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={bgColor} strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)', filter: `drop-shadow(0 0 8px ${color})` }}
      />
    </g>
  )
}

// ─── Hydration Gauge ──────────────────────────────────────────────────────────
function HydrationGauge({ waterMl }: { waterMl: number }) {
  const pct   = Math.min((waterMl / WATER_TARGET_ML) * 100, 100)
  const color = pct >= 100 ? C.calorie : pct >= 50 ? C.water : '#f87171'
  return (
    <div className="flex-1 rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${C.water}22` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Droplets className="w-3.5 h-3.5" style={{ color: C.water }} />
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.water }}>Hydration</span>
        </div>
        <span className="text-[10px] tabular-nums text-gray-400">{waterMl} / {WATER_TARGET_ML} ml</span>
      </div>
      <div className="h-2 rounded-full" style={{ background: '#071520' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}`, transition: 'width 0.5s ease' }} />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-600 tabular-nums">{Math.round(pct)}% of daily target</div>
    </div>
  )
}

// ─── System Clear LED ─────────────────────────────────────────────────────────
function SystemClearLED({ done }: { done: boolean }) {
  return (
    <div className="rounded-xl p-3 flex flex-col items-center justify-center gap-2" style={{ background: C.panel, border: `1px solid ${done ? C.flush + '44' : '#333'}` }}>
      <div className="w-4 h-4 rounded-full" style={{ background: done ? C.flush : '#2a2a2a', boxShadow: done ? `0 0 12px ${C.flush}, 0 0 24px ${C.flush}55` : 'none', transition: 'all 0.4s ease' }} />
      <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: done ? C.flush : '#444' }}>{done ? 'CLEAR' : 'PENDING'}</span>
      <span className="text-[9px] text-gray-600">System</span>
    </div>
  )
}

// ─── Insight row (with glitch on alert) ───────────────────────────────────────
const INSIGHT_CFG: Record<InsightLevel, { Icon: typeof CheckCircle2; color: string; bg: string }> = {
  ok:    { Icon: CheckCircle2,  color: '#39ff14', bg: 'rgba(57,255,20,0.06)'   },
  warn:  { Icon: AlertTriangle, color: '#fbbf24', bg: 'rgba(251,191,36,0.06)'  },
  alert: { Icon: AlertTriangle, color: '#f87171', bg: 'rgba(248,113,113,0.06)' },
  info:  { Icon: Info,          color: '#60a5fa', bg: 'rgba(96,165,250,0.06)'  },
}

function InsightRow({ insight }: { insight: Insight }) {
  const cfg     = INSIGHT_CFG[insight.level]
  const isAlert = insight.level === 'alert'
  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-3 py-2 ${isAlert ? 'nexus-glitch' : ''}`}
      style={{ background: cfg.bg, border: `1px solid ${cfg.color}${isAlert ? '55' : '22'}`, boxShadow: isAlert ? `0 0 12px ${cfg.color}22` : 'none' }}
    >
      <cfg.Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: cfg.color }} />
      <span className="text-xs leading-snug text-gray-200" style={{ fontFamily: "'Courier New', Courier, monospace", letterSpacing: '0.02em' }}>
        {insight.message}
      </span>
    </div>
  )
}

// ─── Quick-log button ─────────────────────────────────────────────────────────
function LogBtn({ label, color, onClick, active }: { label: string; color: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick}
      className="rounded-lg px-3 py-2 text-xs font-bold tracking-wide transition-all hover:scale-105 active:scale-95"
      style={{ background: active ? `${color}30` : `${color}12`, border: `1px solid ${active ? color : color + '44'}`, color, textShadow: active ? `0 0 8px ${color}` : 'none', boxShadow: active ? `0 0 10px ${color}44` : 'none' }}
    >
      {label}
    </button>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function ExecutiveDashboard() {
  const router = useRouter()
  const [data,      setData]      = useState<StoredProfile | null>(null)
  const [log,       setLog]       = useState<DailyLog>({ caloriesIn: 0, caloriesOut: 0, exerciseMinutes: 0, sleepHours: 0, waterMl: 0, flushDone: false })
  const [ghostMode, setGhostMode] = useState(false)
  const [hydrated,  setHydrated]  = useState(false)

  useEffect(() => {
    const profile = loadProfile()
    if (!profile) { router.push('/profile'); return }
    setData(profile)
    setLog(loadDailyLog())
    setHydrated(true)
  }, [router])

  const patch       = useCallback((delta: Partial<DailyLog>) => { patchDailyLog(delta); setLog(loadDailyLog()) }, [])
  const handleReset = useCallback(() => { setLog(resetDailyLog()) }, [])

  if (!hydrated || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050508' }}>
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 animate-pulse" style={{ color: C.calorie }} />
          <span className="text-sm uppercase tracking-widest text-gray-400" style={{ fontFamily: 'monospace' }}>INITIALISING ENGINE…</span>
        </div>
      </div>
    )
  }

  const { metrics }  = data
  const displayLog   = ghostMode ? MOCK_YESTERDAY : log
  const net          = displayLog.caloriesIn - displayLog.caloriesOut
  const balance      = metrics.targetCalories - net
  const calColor     = net > metrics.targetCalories ? '#ff4444' : C.calorie
  const calPct       = Math.min((net / metrics.targetCalories) * 100, 100)
  const exPct        = Math.min((displayLog.exerciseMinutes / 30) * 100, 100)
  const sleepPct     = Math.min((displayLog.sleepHours / 8) * 100, 100)
  const insights     = runRuleEngine(displayLog, metrics.targetCalories, metrics.bmr)
  const hasAlert     = insights.some(i => i.level === 'alert')
  const dateStr      = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="min-h-screen text-white" style={{ background: '#050508' }}>

      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-3" style={{ background: '#0a0d14', borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${C.calorie}18`, border: `1px solid ${C.calorie}44` }}>
            <Zap className="w-4 h-4" style={{ color: C.calorie }} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.25em] uppercase" style={{ color: C.calorie, textShadow: `0 0 10px ${C.calorie}66` }}>Nexus Health</div>
            <div className="text-[9px] tracking-[0.18em] uppercase text-gray-600" style={{ fontFamily: 'monospace' }}>Executive Command Center · V1.2</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGhostMode(g => !g)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase transition-all"
            style={{ background: ghostMode ? `${C.sleep}22` : 'transparent', border: `1px solid ${ghostMode ? C.sleep : '#333'}`, color: ghostMode ? C.sleep : '#444', fontFamily: 'monospace', boxShadow: ghostMode ? `0 0 10px ${C.sleep}44` : 'none' }}
          >
            <Ghost className="w-3 h-3" />
            {ghostMode ? 'GHOST' : 'LIVE'}
          </button>
          <span className="text-[10px] text-gray-600 tracking-widest uppercase" style={{ fontFamily: 'monospace' }}>{dateStr}</span>
          <button onClick={() => router.push('/profile')} className="p-1.5 rounded-md text-gray-600 hover:text-gray-300 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Ghost banner */}
      {ghostMode && (
        <div className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold tracking-widest uppercase" style={{ background: `${C.sleep}12`, borderBottom: `1px solid ${C.sleep}33`, color: C.sleep, fontFamily: 'monospace' }}>
          <Ghost className="w-3 h-3" /> GHOST MODE — Viewing Yesterday&apos;s Data
        </div>
      )}

      {/* Alert banner */}
      {hasAlert && !ghostMode && (
        <div className="nexus-glitch flex items-center justify-center gap-2 py-1.5 text-[10px] font-bold tracking-widest uppercase" style={{ background: 'rgba(248,113,113,0.08)', borderBottom: '1px solid rgba(248,113,113,0.2)', color: '#f87171', fontFamily: 'monospace' }}>
          <AlertTriangle className="w-3 h-3" /> HIGH-PRIORITY ALERT ACTIVE — Review System Status
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── LEFT: Rings ── */}
          <div className="flex flex-col items-center gap-5">
            <div className="flex items-center gap-3">
              <h2 className="text-[10px] font-bold tracking-[0.3em] uppercase text-gray-600" style={{ fontFamily: 'monospace' }}>Daily Progress</h2>
              {ghostMode && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: `${C.sleep}15`, color: C.sleep, border: `1px solid ${C.sleep}33`, fontFamily: 'monospace' }}>YESTERDAY</span>}
            </div>

            {/* Triple Ring */}
            <div className="relative w-[300px] h-[300px]">
              <svg width={300} height={300} viewBox="0 0 300 300" style={{ transform: 'rotate(-90deg)' }}>
                <Ring cx={150} cy={150} r={130} sw={15} pct={calPct}   color={calColor}   bgColor={C.calBg} />
                <Ring cx={150} cy={150} r={100} sw={15} pct={exPct}    color={C.exercise} bgColor={C.exBg}  />
                <Ring cx={150} cy={150} r={70}  sw={15} pct={sleepPct} color={C.sleep}    bgColor={C.slBg}  />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-1" style={{ fontFamily: 'monospace' }}>{ghostMode ? 'YESTERDAY' : 'NET_INTAKE'}</div>
                <div className="text-3xl font-black tabular-nums" style={{ color: calColor, textShadow: `0 0 20px ${calColor}88` }}>{net.toLocaleString()}</div>
                <div className="text-[11px] text-gray-500">/ {metrics.targetCalories.toLocaleString()} kcal</div>
                <div className="mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: balance >= 0 ? `${C.calorie}15` : '#ff444415', color: balance >= 0 ? C.calorie : '#ff4444', border: `1px solid ${balance >= 0 ? C.calorie : '#ff4444'}33`, fontFamily: 'monospace' }}>
                  {balance >= 0 ? `▼ ${balance} remaining` : `▲ ${Math.abs(balance)} over`}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-5 text-xs">
              {[
                { icon: <Flame    className="w-3.5 h-3.5" />, label: 'Calories', val: `${Math.round(calPct)}%`,               color: calColor   },
                { icon: <Activity className="w-3.5 h-3.5" />, label: 'Exercise', val: `${displayLog.exerciseMinutes} min`,      color: C.exercise },
                { icon: <Moon     className="w-3.5 h-3.5" />, label: 'Sleep',    val: `${displayLog.sleepHours} h`,             color: C.sleep    },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span style={{ color: s.color }}>{s.icon}</span>
                  <div>
                    <div className="font-semibold text-[11px]" style={{ color: s.color }}>{s.label}</div>
                    <div className="text-gray-500 text-[10px]">{s.val}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Hydration + LED */}
            <div className="flex items-stretch gap-3 w-full">
              <HydrationGauge waterMl={displayLog.waterMl} />
              <SystemClearLED done={displayLog.flushDone} />
            </div>

            {/* BMR/TDEE/Target */}
            <div className="grid grid-cols-3 gap-3 w-full">
              {[
                { label: 'BMR',    value: metrics.bmr,            color: '#60a5fa' },
                { label: 'TDEE',   value: metrics.tdee,           color: '#fb923c' },
                { label: 'TARGET', value: metrics.targetCalories, color: C.calorie },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: C.panel, border: `1px solid ${s.color}22` }}>
                  <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: s.color, fontFamily: 'monospace' }}>{s.label}</div>
                  <div className="text-lg font-black tabular-nums">{s.value.toLocaleString()}</div>
                  <div className="text-[9px] text-gray-600">kcal</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Status + Log ── */}
          <div className="flex flex-col gap-5">

            {/* System Status */}
            <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-4 rounded-full" style={{ background: C.calorie, boxShadow: `0 0 8px ${C.calorie}` }} />
                <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color: C.calorie, fontFamily: 'monospace' }}>System_Status</span>
                {hasAlert && <span className="ml-auto text-[9px] animate-pulse" style={{ color: '#f87171', fontFamily: 'monospace' }}>● ALERT</span>}
              </div>
              <div className="space-y-2">
                {insights.map((ins, i) => <InsightRow key={i} insight={ins} />)}
              </div>
            </div>

            {/* Quick Log */}
            <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}`, opacity: ghostMode ? 0.4 : 1 }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-4 rounded-full" style={{ background: C.exercise, boxShadow: `0 0 8px ${C.exercise}` }} />
                <span className="text-[10px] font-black tracking-[0.25em] uppercase" style={{ color: C.exercise, fontFamily: 'monospace' }}>Quick_Log</span>
                {ghostMode && <span className="ml-auto text-[9px] text-gray-600" style={{ fontFamily: 'monospace' }}>READ_ONLY</span>}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-2 flex items-center gap-1.5" style={{ fontFamily: 'monospace' }}><Flame className="w-3 h-3" /> Calories</div>
                  <div className="flex flex-wrap gap-2">
                    <LogBtn label="+300 kcal" color={C.calorie} onClick={() => !ghostMode && patch({ caloriesIn: 300  })} />
                    <LogBtn label="+500 kcal" color={C.calorie} onClick={() => !ghostMode && patch({ caloriesIn: 500  })} />
                    <LogBtn label="+800 kcal" color={C.calorie} onClick={() => !ghostMode && patch({ caloriesIn: 800  })} />
                    <LogBtn label="−300 kcal" color="#f87171"   onClick={() => !ghostMode && patch({ caloriesIn: -300 })} />
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-2 flex items-center gap-1.5" style={{ fontFamily: 'monospace' }}><Activity className="w-3 h-3" /> Exercise (~7 kcal/min)</div>
                  <div className="flex flex-wrap gap-2">
                    <LogBtn label="+15 min" color={C.exercise} onClick={() => !ghostMode && patch({ exerciseMinutes: 15,  caloriesOut: 105 })} />
                    <LogBtn label="+30 min" color={C.exercise} onClick={() => !ghostMode && patch({ exerciseMinutes: 30,  caloriesOut: 210 })} />
                    <LogBtn label="+60 min" color={C.exercise} onClick={() => !ghostMode && patch({ exerciseMinutes: 60,  caloriesOut: 420 })} />
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-2 flex items-center gap-1.5" style={{ fontFamily: 'monospace' }}><Droplets className="w-3 h-3" /> Water</div>
                  <div className="flex flex-wrap gap-2">
                    <LogBtn label="+250 ml"  color={C.water} onClick={() => !ghostMode && patch({ waterMl: 250  })} />
                    <LogBtn label="+500 ml"  color={C.water} onClick={() => !ghostMode && patch({ waterMl: 500  })} />
                    <LogBtn label="+1000 ml" color={C.water} onClick={() => !ghostMode && patch({ waterMl: 1000 })} />
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-2 flex items-center gap-1.5" style={{ fontFamily: 'monospace' }}><Moon className="w-3 h-3" /> Sleep</div>
                  <div className="flex flex-wrap gap-2">
                    <LogBtn label="+1 hr"  color={C.sleep} onClick={() => !ghostMode && patch({ sleepHours: 1 })} />
                    <LogBtn label="+6 hrs" color={C.sleep} onClick={() => !ghostMode && patch({ sleepHours: 6 })} />
                    <LogBtn label="+8 hrs" color={C.sleep} onClick={() => !ghostMode && patch({ sleepHours: 8 })} />
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-2" style={{ fontFamily: 'monospace' }}>Bowel Movement</div>
                  <LogBtn label={log.flushDone ? '✓ SYSTEM FLUSHED' : '◎ LOG FLUSH'} color={C.flush} active={log.flushDone} onClick={() => !ghostMode && patch({ flushDone: !log.flushDone })} />
                </div>
                <div className="border-t pt-3" style={{ borderColor: '#1a1a1a' }}>
                  <button onClick={handleReset} disabled={ghostMode} className="flex items-center gap-1.5 text-[10px] text-gray-600 hover:text-gray-400 disabled:opacity-30 transition-colors" style={{ fontFamily: 'monospace' }}>
                    <RotateCcw className="w-3 h-3" /> RESET_FOR_NEW_DAY
                  </button>
                </div>
              </div>
            </div>

            {/* Profile chip */}
            <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <span className="text-[9px] uppercase tracking-widest text-gray-600" style={{ fontFamily: 'monospace' }}>Profile</span>
              <span className="text-[11px] text-gray-400 capitalize">
                {data.profile.gender} · {data.profile.age}y · {data.profile.weightKg}kg ·{' '}
                <span style={{ color: C.calorie }}>{data.profile.goal === 'loss' ? 'Fat Loss' : data.profile.goal === 'gain' ? 'Muscle Gain' : 'Maintain'}</span>
              </span>
            </div>
          </div>
        </div>

        {/* ── Full-width Energy Timeline ── */}
        <EnergyTrendChart net={net} targetCalories={metrics.targetCalories} ghostMode={ghostMode} />

      </div>
    </div>
  )
}
