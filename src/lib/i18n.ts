// Nexus Health i18n — EN / CN
// Tech terms (BMR, TDEE, kcal, ml, GLITCH, V1.6) always stay in English.

import { useState, useEffect } from 'react'

export type Locale = 'en' | 'cn'
export const LOCALE_KEY = 'nexus_locale'

// ─── Template interpolation ───────────────────────────────────────────────────
export function interp(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

// ─── Translation shape ────────────────────────────────────────────────────────
export interface Messages {
  // Header
  subtitle: string
  liveMode: string
  ghostToggle: string
  missionPrefix: string
  // Mission states
  missionStandby: string; missionFatBurn: string; missionRefuel: string
  missionOptimal: string; missionSleep: string; missionRecovery: string
  missionComplete: string
  // Banners
  ghostBanner: string; alertBanner: string
  // Left panel
  dailyProgress: string; yesterdayTag: string
  netIntake: string; yesterdayCenter: string
  remaining: string; over: string
  // Legend
  legendCalories: string; legendExercise: string; legendSleep: string
  // Hydration / LED
  hydrationTitle: string; hydrationPctSuffix: string
  systemClearLabel: string; statusClear: string; statusPending: string
  // Stat cards
  bmrLabel: string; tdeeLabel: string; targetLabel: string
  // Right panel
  systemStatusTitle: string; alertDot: string
  // Quick Log
  quickLogTitle: string; readOnly: string
  calSection: string; exSection: string
  waterSection: string; sleepSection: string; bowelSection: string
  flushDone: string; flushPending: string; resetBtn: string
  // Chart
  energyTimeline: string; yesterdayTimeline: string
  chartTarget: string; chartActual: string; chartProjected: string
  // Time-travel slider
  timeTravelLabel: string; backRealtime: string; simulating: string
  // Sticky tab labels
  tabCal: string; tabEx: string; tabWater: string; tabSleep: string; tabSys: string
  // Profile chip
  profileLabel: string
  goalLoss: string; goalGain: string; goalMaintain: string
  // Tactical Share
  shareBtn: string
  shareWatermark: string
  shareGenerating: string
  shareFilename: string
  // Cloud Sync
  cloudSyncLabel: string
  cloudSyncing: string
  cloudSynced: string
  cloudOffline: string
  // Ghost fallback
  ghostNoData: string
  ghostNoDataHint: string
  // Food search
  foodSearchPlaceholder: string
  foodSearchEmpty: string
  // Execution score
  execScoreLabel: string
  // Profile ID
  profileIdLabel: string
  profileIdCopied: string
  // V1.6: Weekly Efficiency
  weeklyEfficiencyTitle: string
  weeklyAvgLabel: string
  // V1.6: Squad Status
  squadTitle: string
  squadBtn: string
  squadEmpty: string
  squadYou: string
  // V1.6: News Ticker
  tickerGlobalEff: string
  tickerActiveOps: string
  tickerSystemStable: string
  tickerTopScore: string
  // Status messages (use {placeholders})
  msgAwaitingInput: string
  msgDeficitHigh: string      // {bal}
  msgSurplusDetected: string  // {amt}
  msgCalorieOk: string        // {rem}
  msgCrashImminent: string
  msgLowFuel: string          // {time}
  msgFuelPrediction: string   // {time}
  msgNoFuel: string
  msgFuelingClosed: string
  msgExerciseDeficit: string
  msgHighOutput: string       // {min}
  msgExerciseGoalMet: string  // {min}
  msgExerciseInProgress: string // {min} {rem}
  msgSleepMissing: string
  msgSleepCritical: string    // {h}
  msgSleepSuboptimal: string  // {h}
  msgSleepOptimal: string     // {h}
  msgHighDehydration: string
  msgHydrationOptimal: string // {ml}
  msgHydration: string        // {ml} {total} {rem}
  msgMetabolicSluggishness: string
}

// ─── Dictionaries ─────────────────────────────────────────────────────────────
export const translations: Record<Locale, Messages> = {
  en: {
    subtitle:        'Executive Command Center · V1.6',
    liveMode:        'LIVE',
    ghostToggle:     'GHOST',
    missionPrefix:   'MISSION:',
    missionStandby:  'STANDBY_MODE',
    missionFatBurn:  'FAT_BURN_PROTOCOL',
    missionRefuel:   'REFUEL_PROTOCOL',
    missionOptimal:  'OPTIMAL_EXECUTION',
    missionSleep:    'SLEEP_MODE',
    missionRecovery: 'RECOVERY_MODE',
    missionComplete: 'MISSION_COMPLETE',

    ghostBanner: "GHOST MODE — Viewing Yesterday's Data",
    alertBanner: 'HIGH-PRIORITY ALERT ACTIVE — Review System Status',

    dailyProgress:   'Daily Progress',
    yesterdayTag:    'YESTERDAY',
    netIntake:       'NET_INTAKE',
    yesterdayCenter: 'YESTERDAY',
    remaining: 'remaining', over: 'over',

    legendCalories: 'Calories', legendExercise: 'Exercise', legendSleep: 'Sleep',

    hydrationTitle:     'Hydration',
    hydrationPctSuffix: '% of daily target',
    systemClearLabel:   'System',
    statusClear:  'CLEAR', statusPending: 'PENDING',

    bmrLabel: 'BMR', tdeeLabel: 'TDEE', targetLabel: 'TARGET',

    systemStatusTitle: 'System_Status', alertDot: '● ALERT',

    quickLogTitle: 'Quick_Log', readOnly: 'READ_ONLY',
    calSection:   'Calories',
    exSection:    'Exercise (~7 kcal/min)',
    waterSection: 'Water',
    sleepSection: 'Sleep',
    bowelSection: 'Bowel Movement',
    flushDone:    '✓ SYSTEM FLUSHED',
    flushPending: '◎ LOG FLUSH',
    resetBtn:     'RESET_FOR_NEW_DAY',

    energyTimeline:   'Energy_Timeline',
    yesterdayTimeline:'Energy_Timeline — Yesterday',
    chartTarget:    'Target', chartActual: 'Actual', chartProjected: 'Projected',

    timeTravelLabel: 'TIME_TRAVEL',
    backRealtime:    '⟳ BACK TO REALTIME',
    simulating:      'SIMULATING',

    tabCal: 'Kcal', tabEx: 'Move', tabWater: 'H₂O', tabSleep: 'Sleep', tabSys: 'Sys',

    profileLabel:   'Profile',
    goalLoss:    'Fat Loss', goalGain: 'Muscle Gain', goalMaintain: 'Maintain',

    // Tactical Share
    shareBtn:        'SHARE',
    shareWatermark:  'NEXUS HEALTH SYSTEM',
    shareGenerating: 'GENERATING...',
    shareFilename:   'nexus-tactical-report',
    // Cloud Sync
    cloudSyncLabel:  'Cloud Sync',
    cloudSyncing:    'SYNCING',
    cloudSynced:     'SYNCED',
    cloudOffline:    'OFFLINE',
    // Ghost fallback
    ghostNoData:     'NO INTEL FOR YESTERDAY',
    ghostNoDataHint: 'Start logging today — tomorrow this will show your data.',
    // Food search
    foodSearchPlaceholder: 'Search food...',
    foodSearchEmpty:       'No match. Use +kcal buttons.',
    // Execution score
    execScoreLabel:        'SYS_EFF',
    // Profile ID
    profileIdLabel:        'Profile ID',
    profileIdCopied:       'Copied!',
    // V1.6: Weekly Efficiency
    weeklyEfficiencyTitle: '7-Day Efficiency',
    weeklyAvgLabel:        'AVG:',
    // V1.6: Squad Status
    squadTitle:            'Squad Status',
    squadBtn:              'SQUAD',
    squadEmpty:            'No operatives found. Deploy more agents.',
    squadYou:              'YOU',
    // V1.6: News Ticker
    tickerGlobalEff:       'GLOBAL_AVG_EFFICIENCY',
    tickerActiveOps:       'ACTIVE_OPERATIVES',
    tickerSystemStable:    'ALL_SYSTEMS_NOMINAL',
    tickerTopScore:        'TOP_SCORE',

    // Status messages
    msgAwaitingInput:      '> AWAITING_INPUT  No calories logged. Begin tracking.',
    msgDeficitHigh:        '> DEFICIT_HIGH [{bal} kcal]  Consume 300 kcal snack to protect lean mass.',
    msgSurplusDetected:    '> SURPLUS_DETECTED [+{amt} kcal]  Execute 20 min cardio protocol.',
    msgCalorieOk:          '> CALORIE_BALANCE_OK  {rem}',
    msgCrashImminent:      '> ALERT: Metabolic crash imminent. Please refuel now.',
    msgLowFuel:            '> PREDICTION: Low fuel warning. Estimated exhaustion at {time}.',
    msgFuelPrediction:     '> PREDICTION: Estimated fuel exhaustion at {time}.',
    msgNoFuel:             '> PREDICTION: No fuel detected. Metabolic crash risk active.',
    msgFuelingClosed:      '> FUELING_CLOSED  System entering sleep mode. No further intake advised.',
    msgExerciseDeficit:    '> EXERCISE_DEFICIT  Minimum 30 min activity required today.',
    msgHighOutput:         '> HIGH_OUTPUT [{min} min]  Recovery protocol now active.',
    msgExerciseGoalMet:    '> EXERCISE_GOAL_MET [{min} min]  Well executed.',
    msgExerciseInProgress: '> EXERCISE_IN_PROGRESS [{min} min]  {rem} min to target.',
    msgSleepMissing:       '> SLEEP_DATA_MISSING  Log recovery hours to enable analysis.',
    msgSleepCritical:      '> CRITICAL_SLEEP_DEFICIT [{h}h]  Performance severely compromised.',
    msgSleepSuboptimal:    '> SLEEP_SUBOPTIMAL [{h}h]  Target 7–9 h for full recovery.',
    msgSleepOptimal:       '> RECOVERY_OPTIMAL [{h}h]  System fully restored.',
    msgHighDehydration:    '> HIGH_DEHYDRATION_RISK  Immediate action: consume 500 ml now.',
    msgHydrationOptimal:   '> HYDRATION_OPTIMAL [{ml} ml]  Daily target achieved.',
    msgHydration:          '> HYDRATION [{ml} / {total} ml]  {rem} ml remaining.',
    msgMetabolicSluggishness: '> METABOLIC_SLUGGISHNESS  Bowel movement not logged. Increase fiber and water.',
  },

  cn: {
    subtitle:        '执行指挥中心 · V1.6',
    liveMode:        '实时',
    ghostToggle:     '昨日',
    missionPrefix:   '当前任务:',
    missionStandby:  '待命模式',
    missionFatBurn:  '脂肪燃烧协议',
    missionRefuel:   '紧急补给协议',
    missionOptimal:  '最优执行状态',
    missionSleep:    '睡眠模式',
    missionRecovery: '恢复模式',
    missionComplete: '任务完成',

    ghostBanner: '幽灵模式 — 正在查看昨日数据',
    alertBanner: '高优先级警报已激活 — 请查看系统状态',

    dailyProgress:   '今日进度',
    yesterdayTag:    '昨日',
    netIntake:       '净摄入',
    yesterdayCenter: '昨日',
    remaining: '剩余', over: '超出',

    legendCalories: '热量', legendExercise: '运动', legendSleep: '睡眠',

    hydrationTitle:     '水分',
    hydrationPctSuffix: '%的每日目标',
    systemClearLabel:   '系统',
    statusClear: '畅通', statusPending: '待确认',

    bmrLabel: 'BMR', tdeeLabel: 'TDEE', targetLabel: '目标',

    systemStatusTitle: '系统状态', alertDot: '● 警报',

    quickLogTitle: '快速记录', readOnly: '只读模式',
    calSection:   '热量 (kcal)',
    exSection:    '运动 (~7 kcal/分钟)',
    waterSection: '饮水 (ml)',
    sleepSection: '睡眠',
    bowelSection: '肠道状态',
    flushDone:    '✓ 系统畅通',
    flushPending: '◎ 记录排便',
    resetBtn:     '重置今日数据',

    energyTimeline:    '能量时间线',
    yesterdayTimeline: '能量时间线 — 昨日',
    chartTarget: '目标', chartActual: '实际', chartProjected: '预测',

    timeTravelLabel: '时间模拟',
    backRealtime:    '⟳ 返回实时',
    simulating:      '模拟中',

    tabCal: '热量', tabEx: '运动', tabWater: '水分', tabSleep: '睡眠', tabSys: '系统',

    profileLabel: '档案',
    goalLoss: '减脂', goalGain: '增肌', goalMaintain: '维持',

    // Tactical Share
    shareBtn:        '分享',
    shareWatermark:  'NEXUS HEALTH SYSTEM',
    shareGenerating: '生成中...',
    shareFilename:   'nexus-战报',
    // Cloud Sync
    cloudSyncLabel:  '云端同步',
    cloudSyncing:    '同步中',
    cloudSynced:     '已同步',
    cloudOffline:    '离线',
    // Ghost fallback
    ghostNoData:     '昨日无数据',
    ghostNoDataHint: '今天开始记录，明天这里就能看到你的数据。',
    // Food search
    foodSearchPlaceholder: '搜索食物...',
    foodSearchEmpty:       '无匹配结果，请使用 +kcal 按钮。',
    // Execution score
    execScoreLabel:        '系统效率',
    // Profile ID
    profileIdLabel:        '用户 ID',
    profileIdCopied:       '已复制!',
    // V1.6: Weekly Efficiency
    weeklyEfficiencyTitle: '7日效率趋势',
    weeklyAvgLabel:        '均值:',
    // V1.6: Squad Status
    squadTitle:            '小队状态',
    squadBtn:              '小队',
    squadEmpty:            '未找到行动人员。部署更多成员。',
    squadYou:              '你',
    // V1.6: News Ticker
    tickerGlobalEff:       '全局平均效率',
    tickerActiveOps:       '活跃人员',
    tickerSystemStable:    '全部系统正常',
    tickerTopScore:        '最高分',

    // Status messages (> CODE prefix + tech terms kept in English)
    msgAwaitingInput:      '> AWAITING_INPUT  未记录热量。请开始追踪。',
    msgDeficitHigh:        '> DEFICIT_HIGH [{bal} kcal]  建议摄入 300 kcal 零食以保护肌肉量。',
    msgSurplusDetected:    '> SURPLUS_DETECTED [+{amt} kcal]  建议增加 20 分钟有氧运动。',
    msgCalorieOk:          '> CALORIE_BALANCE_OK  {rem}',
    msgCrashImminent:      '> ALERT: 代谢崩溃迫在眉睫。请立即补充能量。',
    msgLowFuel:            '> PREDICTION: 燃料不足，预计在 {time} 耗尽。',
    msgFuelPrediction:     '> PREDICTION: 预计燃料耗尽时间：{time}。',
    msgNoFuel:             '> PREDICTION: 未检测到燃料。代谢崩溃风险已激活。',
    msgFuelingClosed:      '> FUELING_CLOSED  系统进入睡眠模式。不建议继续摄入。',
    msgExerciseDeficit:    '> EXERCISE_DEFICIT  今日最低要求：30 分钟运动。',
    msgHighOutput:         '> HIGH_OUTPUT [{min} 分钟]  高强度训练完成，恢复协议已激活。',
    msgExerciseGoalMet:    '> EXERCISE_GOAL_MET [{min} 分钟]  执行完美。',
    msgExerciseInProgress: '> EXERCISE_IN_PROGRESS [{min} 分钟]  距目标还差 {rem} 分钟。',
    msgSleepMissing:       '> SLEEP_DATA_MISSING  请记录睡眠时长以启用恢复分析。',
    msgSleepCritical:      '> CRITICAL_SLEEP_DEFICIT [{h}h]  睡眠严重不足，表现将大幅下降。',
    msgSleepSuboptimal:    '> SLEEP_SUBOPTIMAL [{h}h]  建议 7–9 小时以达到完全恢复。',
    msgSleepOptimal:       '> RECOVERY_OPTIMAL [{h}h]  系统已完全恢复。',
    msgHighDehydration:    '> HIGH_DEHYDRATION_RISK  立即行动：请补充 500 ml 水分。',
    msgHydrationOptimal:   '> HYDRATION_OPTIMAL [{ml} ml]  每日目标已达成。',
    msgHydration:          '> HYDRATION [{ml} / {total} ml]  还需 {rem} ml。',
    msgMetabolicSluggishness: '> METABOLIC_SLUGGISHNESS  未记录排便。请增加膳食纤维和水分摄入。',
  },
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLocale(): [Locale, (l: Locale) => void] {
  const [locale, setLocaleState] = useState<Locale>('cn')

  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_KEY) as Locale | null
    if (stored === 'en' || stored === 'cn') setLocaleState(stored)
  }, [])

  function setLocale(l: Locale) {
    localStorage.setItem(LOCALE_KEY, l)
    setLocaleState(l)
  }

  return [locale, setLocale]
}
