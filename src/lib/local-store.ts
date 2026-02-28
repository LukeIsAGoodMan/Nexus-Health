import { type UserProfile, type HealthMetrics } from './health-engine'

const PROFILE_KEY = 'nexus_profile'
const LOG_KEY     = 'nexus_daily_log'

export interface StoredProfile {
  profile: UserProfile
  metrics: HealthMetrics
}

export interface DailyLog {
  caloriesIn:      number   // kcal consumed
  caloriesOut:     number   // kcal burned via exercise
  exerciseMinutes: number
  sleepHours:      number
  waterMl:         number   // ml of water consumed
  flushDone:       boolean  // daily bowel movement completed
}

export const DEFAULT_LOG: DailyLog = {
  caloriesIn:      0,
  caloriesOut:     0,
  exerciseMinutes: 0,
  sleepHours:      0,
  waterMl:         0,
  flushDone:       false,
}

export function saveProfile(data: StoredProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data))
}

export function loadProfile(): StoredProfile | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(PROFILE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as StoredProfile } catch { return null }
}

export function loadDailyLog(): DailyLog {
  if (typeof window === 'undefined') return { ...DEFAULT_LOG }
  const raw = localStorage.getItem(LOG_KEY)
  if (!raw) return { ...DEFAULT_LOG }
  try { return { ...DEFAULT_LOG, ...(JSON.parse(raw) as Partial<DailyLog>) } } catch { return { ...DEFAULT_LOG } }
}

export function saveDailyLog(log: DailyLog): void {
  localStorage.setItem(LOG_KEY, JSON.stringify(log))
}

/** Numeric fields are additive; flushDone is a direct set when provided. */
export function patchDailyLog(patch: Partial<DailyLog>): DailyLog {
  const cur = loadDailyLog()
  const next: DailyLog = {
    caloriesIn:      Math.max(0, cur.caloriesIn      + (patch.caloriesIn      ?? 0)),
    caloriesOut:     Math.max(0, cur.caloriesOut     + (patch.caloriesOut     ?? 0)),
    exerciseMinutes: Math.max(0, cur.exerciseMinutes + (patch.exerciseMinutes ?? 0)),
    sleepHours:      Math.max(0, cur.sleepHours      + (patch.sleepHours      ?? 0)),
    waterMl:         Math.max(0, cur.waterMl         + (patch.waterMl         ?? 0)),
    flushDone:       patch.flushDone !== undefined ? patch.flushDone : cur.flushDone,
  }
  saveDailyLog(next)
  return next
}

export function resetDailyLog(): DailyLog {
  saveDailyLog({ ...DEFAULT_LOG })
  return { ...DEFAULT_LOG }
}

// ─── Food Frequency Tracking (V1.7) ─────────────────────────────────────────
const FOOD_FREQ_KEY = 'nexus_food_freq'

export function loadFoodFrequency(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  const raw = localStorage.getItem(FOOD_FREQ_KEY)
  if (!raw) return {}
  try { return JSON.parse(raw) as Record<string, number> } catch { return {} }
}

export function bumpFoodFrequency(foodId: string): Record<string, number> {
  const freq = loadFoodFrequency()
  freq[foodId] = (freq[foodId] ?? 0) + 1
  localStorage.setItem(FOOD_FREQ_KEY, JSON.stringify(freq))
  return freq
}

// ─── Tactical Macros (V1.9) ─────────────────────────────────────────────────
const MACROS_KEY = 'nexus_macros'

export interface TacticalMacro {
  id: string
  name: string
  kcal: number
}

export function loadMacros(): TacticalMacro[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(MACROS_KEY)
  if (!raw) return []
  try { return JSON.parse(raw) as TacticalMacro[] } catch { return [] }
}

export function saveMacro(macro: TacticalMacro): TacticalMacro[] {
  const macros = loadMacros()
  macros.push(macro)
  localStorage.setItem(MACROS_KEY, JSON.stringify(macros))
  return macros
}

export function deleteMacro(id: string): TacticalMacro[] {
  const macros = loadMacros().filter(m => m.id !== id)
  localStorage.setItem(MACROS_KEY, JSON.stringify(macros))
  return macros
}
