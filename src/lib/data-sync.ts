/**
 * Nexus Health V1.4 — Cloud Soul Data Layer
 *
 * Strategy:
 *   WRITE → localStorage (instant) + Supabase (async)
 *   READ  → Supabase first; if offline / error → localStorage fallback
 *
 * A client-generated UUID stored in localStorage identifies the user
 * until a proper auth system is added.
 */

import { createClient } from '@/lib/supabase/client'
import {
  type UserProfile, type HealthMetrics,
  type DaySnapshot, calculateExecutionScore,
} from './health-engine'
import {
  type StoredProfile,
  type DailyLog,
  saveProfile as lsSaveProfile,
  loadProfile as lsLoadProfile,
  saveDailyLog as lsSaveDailyLog,
  loadDailyLog as lsLoadDailyLog,
  DEFAULT_LOG,
} from './local-store'

// ─── Sync State ─────────────────────────────────────────────────────────────
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline'

type SyncListener = (status: SyncStatus) => void
const listeners = new Set<SyncListener>()
let currentStatus: SyncStatus = 'idle'

function setSyncStatus(s: SyncStatus) {
  currentStatus = s
  listeners.forEach(fn => fn(s))
  // Auto-reset synced → idle after 3s
  if (s === 'synced') setTimeout(() => setSyncStatus('idle'), 3000)
}

export function getSyncStatus(): SyncStatus { return currentStatus }
export function onSyncChange(fn: SyncListener) { listeners.add(fn); return () => { listeners.delete(fn) } }

// ─── User ID ────────────────────────────────────────────────────────────────
const UID_KEY = 'nexus_user_id'

export function getUserId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(UID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(UID_KEY, id)
  }
  return id
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function supabase() {
  return createClient()
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
}

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url !== '' && !url.includes('your-supabase')
}

// ─── Profile ────────────────────────────────────────────────────────────────

export async function cloudSaveProfile(data: StoredProfile): Promise<void> {
  // Always write to localStorage first (instant)
  lsSaveProfile(data)

  if (!isSupabaseConfigured()) return

  const uid = getUserId()
  const { profile, metrics } = data

  const row = {
    user_id:         uid,
    height_cm:       profile.heightCm,
    weight_kg:       profile.weightKg,
    age:             profile.age,
    gender:          profile.gender,
    goal:            profile.goal,
    activity_level:  profile.activityLevel,
    bmr:             metrics.bmr,
    tdee:            metrics.tdee,
    target_calories: metrics.targetCalories,
  }

  try {
    setSyncStatus('syncing')
    await supabase()
      .from('profiles')
      .upsert(row, { onConflict: 'user_id' })
    setSyncStatus('synced')
  } catch {
    setSyncStatus('offline')
  }
}

export async function cloudLoadProfile(): Promise<StoredProfile | null> {
  if (!isSupabaseConfigured()) return lsLoadProfile()

  const uid = getUserId()
  if (!uid) return lsLoadProfile()

  try {
    const { data, error } = await supabase()
      .from('profiles')
      .select('*')
      .eq('user_id', uid)
      .single()

    if (error || !data) return lsLoadProfile()

    const profile: UserProfile = {
      heightCm:      data.height_cm,
      weightKg:      data.weight_kg,
      age:           data.age,
      gender:        data.gender,
      goal:          data.goal,
      activityLevel: data.activity_level,
    }
    const metrics: HealthMetrics = {
      bmr:            data.bmr,
      tdee:           data.tdee,
      targetCalories: data.target_calories,
    }

    const stored: StoredProfile = { profile, metrics }
    // Sync cloud → localStorage cache
    lsSaveProfile(stored)
    return stored
  } catch {
    return lsLoadProfile()
  }
}

// ─── Daily Logs ─────────────────────────────────────────────────────────────

export async function cloudSaveDailyLog(log: DailyLog): Promise<void> {
  // Always write to localStorage first (instant)
  lsSaveDailyLog(log)

  if (!isSupabaseConfigured()) return

  const uid = getUserId()
  if (!uid) return

  const row = {
    user_id:          uid,
    log_date:         todayISO(),
    calories_in:      log.caloriesIn,
    calories_out:     log.caloriesOut,
    exercise_minutes: log.exerciseMinutes,
    sleep_hours:      log.sleepHours,
    water_ml:         log.waterMl,
    flush_done:       log.flushDone,
  }

  try {
    setSyncStatus('syncing')
    await supabase()
      .from('daily_logs')
      .upsert(row, { onConflict: 'user_id,log_date' })
    setSyncStatus('synced')
  } catch {
    setSyncStatus('offline')
  }
}

export async function cloudLoadDailyLog(): Promise<DailyLog> {
  if (!isSupabaseConfigured()) return lsLoadDailyLog()

  const uid = getUserId()
  if (!uid) return lsLoadDailyLog()

  try {
    const { data, error } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('user_id', uid)
      .eq('log_date', todayISO())
      .single()

    if (error || !data) return lsLoadDailyLog()

    const log: DailyLog = {
      caloriesIn:      data.calories_in,
      caloriesOut:     data.calories_out,
      exerciseMinutes: data.exercise_minutes,
      sleepHours:      data.sleep_hours,
      waterMl:         data.water_ml,
      flushDone:       data.flush_done,
    }
    // Sync cloud → localStorage cache
    lsSaveDailyLog(log)
    return log
  } catch {
    return lsLoadDailyLog()
  }
}

export async function cloudPatchDailyLog(patch: Partial<DailyLog>): Promise<DailyLog> {
  // Read current from localStorage (instant, already synced)
  const cur = lsLoadDailyLog()
  const next: DailyLog = {
    caloriesIn:      Math.max(0, cur.caloriesIn      + (patch.caloriesIn      ?? 0)),
    caloriesOut:     Math.max(0, cur.caloriesOut     + (patch.caloriesOut     ?? 0)),
    exerciseMinutes: Math.max(0, cur.exerciseMinutes + (patch.exerciseMinutes ?? 0)),
    sleepHours:      Math.max(0, cur.sleepHours      + (patch.sleepHours      ?? 0)),
    waterMl:         Math.max(0, cur.waterMl         + (patch.waterMl         ?? 0)),
    flushDone:       patch.flushDone !== undefined ? patch.flushDone : cur.flushDone,
  }
  // Write-through: localStorage + Supabase
  await cloudSaveDailyLog(next)
  return next
}

export async function cloudResetDailyLog(): Promise<DailyLog> {
  const fresh = { ...DEFAULT_LOG }
  await cloudSaveDailyLog(fresh)
  return fresh
}

// ─── Recent logs (for Execution Score) ──────────────────────────────────────

function buildDateRange(dayCount: number): string[] {
  const dates: string[] = []
  for (let i = 0; i < dayCount; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

function mapRowToLog(row: Record<string, unknown>): DailyLog {
  return {
    caloriesIn:      row.calories_in as number,
    caloriesOut:     row.calories_out as number,
    exerciseMinutes: row.exercise_minutes as number,
    sleepHours:      row.sleep_hours as number,
    waterMl:         row.water_ml as number,
    flushDone:       row.flush_done as boolean,
  }
}

export async function cloudLoadRecentLogs(dayCount: number): Promise<DailyLog[]> {
  if (!isSupabaseConfigured()) return []

  const uid = getUserId()
  if (!uid) return []

  const dates = buildDateRange(dayCount)

  try {
    const { data, error } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('user_id', uid)
      .in('log_date', dates)
      .order('log_date', { ascending: false })

    if (error || !data) return dates.map(() => ({ ...DEFAULT_LOG }))

    // Pad missing days with DEFAULT_LOG so missing days score 0
    const rowMap = new Map<string, DailyLog>()
    for (const row of data) rowMap.set(row.log_date as string, mapRowToLog(row))
    return dates.map(d => rowMap.get(d) ?? { ...DEFAULT_LOG })
  } catch {
    return []
  }
}

export async function cloudLoadRecentLogsWithDates(
  dayCount: number,
): Promise<{ date: string; log: DailyLog }[]> {
  if (!isSupabaseConfigured()) return []

  const uid = getUserId()
  if (!uid) return []

  const dates = buildDateRange(dayCount)

  try {
    const { data, error } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('user_id', uid)
      .in('log_date', dates)

    const rowMap = new Map<string, DailyLog>()
    if (!error && data) {
      for (const row of data) rowMap.set(row.log_date as string, mapRowToLog(row))
    }
    // Return newest→oldest with padding
    return dates.map(d => ({ date: d, log: rowMap.get(d) ?? { ...DEFAULT_LOG } }))
  } catch {
    return []
  }
}

// ─── Leaderboard (V1.6) ───────────────────────────────────────────────────

export interface LeaderboardEntry {
  userId: string
  score: number
  goal: string
}

export async function cloudLoadLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured()) return []

  try {
    // 1. All daily_logs from last 3 days (all users)
    const dates = buildDateRange(3)
    const { data: logs, error: logErr } = await supabase()
      .from('daily_logs')
      .select('user_id, log_date, calories_in, calories_out, exercise_minutes, sleep_hours, water_ml')
      .in('log_date', dates)

    if (logErr || !logs) return []

    // 2. All profiles for target_calories + goal
    const { data: profiles, error: profErr } = await supabase()
      .from('profiles')
      .select('user_id, target_calories, goal')

    if (profErr || !profiles) return []

    // 3. Group logs by user, compute scores
    const profileMap = new Map(profiles.map((p: Record<string, unknown>) =>
      [p.user_id as string, p] as const
    ))
    const userLogs = new Map<string, DaySnapshot[]>()

    for (const row of logs) {
      const snap: DaySnapshot = {
        caloriesIn:      row.calories_in as number,
        caloriesOut:     row.calories_out as number,
        exerciseMinutes: row.exercise_minutes as number,
        sleepHours:      row.sleep_hours as number,
        waterMl:         row.water_ml as number,
      }
      const arr = userLogs.get(row.user_id as string) ?? []
      arr.push(snap)
      userLogs.set(row.user_id as string, arr)
    }

    // 4. Score per user (pad to 3 days)
    const entries: LeaderboardEntry[] = []
    for (const [userId, snaps] of userLogs) {
      const prof = profileMap.get(userId)
      if (!prof) continue
      while (snaps.length < 3) {
        snaps.push({ caloriesIn: 0, caloriesOut: 0, exerciseMinutes: 0, sleepHours: 0, waterMl: 0 })
      }
      entries.push({
        userId,
        score: calculateExecutionScore(snaps, prof.target_calories as number),
        goal:  prof.goal as string,
      })
    }

    entries.sort((a, b) => b.score - a.score)
    return entries.slice(0, 10)
  } catch {
    return []
  }
}

// ─── Yesterday's log (for Ghost Mode) ───────────────────────────────────────

export async function cloudLoadYesterdayLog(): Promise<DailyLog | null> {
  if (!isSupabaseConfigured()) return null

  const uid = getUserId()
  if (!uid) return null

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().slice(0, 10)

  try {
    const { data, error } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('user_id', uid)
      .eq('log_date', dateStr)
      .single()

    if (error || !data) return null

    return {
      caloriesIn:      data.calories_in,
      caloriesOut:     data.calories_out,
      exerciseMinutes: data.exercise_minutes,
      sleepHours:      data.sleep_hours,
      waterMl:         data.water_ml,
      flushDone:       data.flush_done,
    }
  } catch {
    return null
  }
}

// ─── Load log for a specific date (V1.8: Archive panel) ─────────────────────

export async function cloudLoadLogByDate(dateStr: string): Promise<DailyLog | null> {
  if (!isSupabaseConfigured()) return null

  const uid = getUserId()
  if (!uid) return null

  try {
    const { data, error } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('user_id', uid)
      .eq('log_date', dateStr)
      .single()

    if (error || !data) return null

    return {
      caloriesIn:      data.calories_in,
      caloriesOut:     data.calories_out,
      exerciseMinutes: data.exercise_minutes,
      sleepHours:      data.sleep_hours,
      waterMl:         data.water_ml,
      flushDone:       data.flush_done,
    }
  } catch {
    return null
  }
}
