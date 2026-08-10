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

export interface UsageSummary {
  ranges: {
    today: RangeStat
    last7d: RangeStat
    last30d: RangeStat
  }
  groups: UsageGroup[]
  total: RangeStat
}
