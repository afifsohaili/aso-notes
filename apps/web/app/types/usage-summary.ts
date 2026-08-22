export interface RangeStat {
  generations: number
  tokens: number
  costUsd: string
  usageMissingGenerations: number
}

export interface UsageGroup extends RangeStat {
  useCase: string
  model: string
}

export interface DailyStat extends RangeStat {
  day: string
}

export interface UsageSummary {
  ranges: {
    today: RangeStat
    last7d: RangeStat
    last30d: RangeStat
  }
  daily: DailyStat[]
  groups: UsageGroup[]
  total: RangeStat
}
