// Nexus Health — Core calculation engine
// BMR: Mifflin-St Jeor equation
// TDEE: BMR × activity multiplier

export const WATER_TARGET_ML = 2000  // daily hydration target (ml)

export type Gender = 'male' | 'female'
export type Goal = 'loss' | 'gain' | 'maintain'
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'

export interface UserProfile {
  heightCm: number
  weightKg: number
  age: number
  gender: Gender
  goal: Goal
  activityLevel: ActivityLevel
}

export interface HealthMetrics {
  bmr: number           // kcal/day — Basal Metabolic Rate
  tdee: number          // kcal/day — Total Daily Energy Expenditure
  targetCalories: number // kcal/day — adjusted for goal
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary:   1.2,    // desk job, no exercise
  light:       1.375,  // 1–3 days/week light exercise
  moderate:    1.55,   // 3–5 days/week moderate exercise
  active:      1.725,  // 6–7 days/week hard exercise
  very_active: 1.9,    // physical job + training
}

const GOAL_CALORIE_DELTA: Record<Goal, number> = {
  loss:     -500,
  gain:     +500,
  maintain:    0,
}

/**
 * Mifflin-St Jeor BMR
 * Male:   10w + 6.25h − 5a + 5
 * Female: 10w + 6.25h − 5a − 161
 */
export function calculateBMR(profile: Pick<UserProfile, 'weightKg' | 'heightCm' | 'age' | 'gender'>): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age
  return Math.round(profile.gender === 'male' ? base + 5 : base - 161)
}

/** TDEE = BMR × activity multiplier */
export function calculateTDEE(profile: Pick<UserProfile, 'weightKg' | 'heightCm' | 'age' | 'gender' | 'activityLevel'>): number {
  const bmr = calculateBMR(profile)
  return Math.round(bmr * ACTIVITY_MULTIPLIERS[profile.activityLevel])
}

/** Full metrics: BMR, TDEE, and goal-adjusted target calories */
export function calculateHealthMetrics(profile: UserProfile): HealthMetrics {
  const bmr = calculateBMR(profile)
  const tdee = Math.round(bmr * ACTIVITY_MULTIPLIERS[profile.activityLevel])
  const targetCalories = tdee + GOAL_CALORIE_DELTA[profile.goal]
  return { bmr, tdee, targetCalories }
}
