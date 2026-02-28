'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, Target, ChevronRight, User, Scale, Ruler, Calendar, Dumbbell, Zap } from 'lucide-react'
import { calculateHealthMetrics, type UserProfile, type Gender, type Goal, type ActivityLevel } from '@/lib/health-engine'
import { cloudSaveProfile } from '@/lib/data-sync'

interface FormState {
  heightCm: string
  weightKg: string
  age: string
  gender: Gender | ''
  goal: Goal | ''
  activityLevel: ActivityLevel | ''
}

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; description: string }[] = [
  { value: 'sedentary',   label: 'Sedentary',   description: 'Desk job, little or no exercise' },
  { value: 'light',       label: 'Light',        description: '1–3 days/week light exercise' },
  { value: 'moderate',    label: 'Moderate',     description: '3–5 days/week moderate exercise' },
  { value: 'active',      label: 'Active',       description: '6–7 days/week hard training' },
  { value: 'very_active', label: 'Very Active',  description: 'Physical job + daily training' },
]

const GOAL_OPTIONS: { value: Goal; label: string; icon: string; description: string }[] = [
  { value: 'loss',     label: 'Lose Weight',  icon: '📉', description: 'Caloric deficit (−500 kcal)' },
  { value: 'maintain', label: 'Maintain',     icon: '⚖️',  description: 'Eat at maintenance (TDEE)' },
  { value: 'gain',     label: 'Build Muscle', icon: '💪',  description: 'Caloric surplus (+500 kcal)' },
]

export default function ProfileSetup() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>({
    heightCm: '', weightKg: '', age: '', gender: '', goal: '', activityLevel: '',
  })
  const [launching, setLaunching] = useState(false)

  const isComplete =
    form.heightCm && form.weightKg && form.age &&
    form.gender && form.goal && form.activityLevel

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isComplete || launching) return
    setLaunching(true)

    const profile: UserProfile = {
      heightCm:      parseFloat(form.heightCm),
      weightKg:      parseFloat(form.weightKg),
      age:           parseInt(form.age, 10),
      gender:        form.gender as Gender,
      goal:          form.goal as Goal,
      activityLevel: form.activityLevel as ActivityLevel,
    }

    const metrics = calculateHealthMetrics(profile)
    cloudSaveProfile({ profile, metrics }).then(() => {
      router.push('/dashboard')
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">Nexus Health</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Set Up Your Profile</h1>
          <p className="text-gray-400">We'll calculate your personalised daily calorie targets.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Height & Weight */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
                <Ruler className="w-4 h-4" /> Height (cm)
              </label>
              <input
                type="number" min={100} max={250} placeholder="e.g. 175"
                value={form.heightCm}
                onChange={e => setForm(f => ({ ...f, heightCm: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
                <Scale className="w-4 h-4" /> Weight (kg)
              </label>
              <input
                type="number" min={30} max={300} step={0.1} placeholder="e.g. 75"
                value={form.weightKg}
                onChange={e => setForm(f => ({ ...f, weightKg: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
          </div>

          {/* Age */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
              <Calendar className="w-4 h-4" /> Age
            </label>
            <input
              type="number" min={15} max={100} placeholder="e.g. 28"
              value={form.age}
              onChange={e => setForm(f => ({ ...f, age: e.target.value }))}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
              <User className="w-4 h-4" /> Gender
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(['male', 'female'] as Gender[]).map(g => (
                <button key={g} type="button" onClick={() => setForm(f => ({ ...f, gender: g }))}
                  className={`py-2.5 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    form.gender === g
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                      : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'
                  }`}
                >{g}</button>
              ))}
            </div>
          </div>

          {/* Goal */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
              <Target className="w-4 h-4" /> Goal
            </label>
            <div className="grid grid-cols-3 gap-3">
              {GOAL_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, goal: opt.value }))}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    form.goal === opt.value
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                  }`}
                >
                  <div className="text-xl mb-1">{opt.icon}</div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Activity Level */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
              <Dumbbell className="w-4 h-4" /> Activity Level
            </label>
            <div className="space-y-2">
              {ACTIVITY_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, activityLevel: opt.value }))}
                  className={`w-full p-3 rounded-lg border text-left flex items-center justify-between transition-colors ${
                    form.activityLevel === opt.value
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-gray-500">{opt.description}</div>
                  </div>
                  {form.activityLevel === opt.value && (
                    <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit" disabled={!isComplete || launching}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {launching
              ? <><Zap className="w-4 h-4 animate-pulse" /> Launching Dashboard...</>
              : <><ChevronRight className="w-4 h-4" /> Launch My Dashboard</>
            }
          </button>
        </form>
      </main>
    </div>
  )
}
