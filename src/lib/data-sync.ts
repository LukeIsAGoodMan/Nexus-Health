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
import { type UserProfile, type HealthMetrics } from './health-engine'
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

export async function cloudLoadRecentLogs(dayCount: number): Promise<DailyLog[]> {
  if (!isSupabaseConfigured()) return []

  const uid = getUserId()
  if (!uid) return []

  const dates: string[] = []
  for (let i = 0; i < dayCount; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }

  try {
    const { data, error } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('user_id', uid)
      .in('log_date', dates)
      .order('log_date', { ascending: false })

    if (error || !data) return []

    return data.map((row: Record<string, unknown>) => ({
      caloriesIn:      row.calories_in as number,
      caloriesOut:     row.calories_out as number,
      exerciseMinutes: row.exercise_minutes as number,
      sleepHours:      row.sleep_hours as number,
      waterMl:         row.water_ml as number,
      flushDone:       row.flush_done as boolean,
    }))
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
