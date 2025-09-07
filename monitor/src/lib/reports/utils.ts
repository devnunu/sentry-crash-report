// 한국 시간대 유틸리티
export const KST_OFFSET = 9 * 60 * 60 * 1000 // 9시간을 밀리초로

// 날짜를 KST로 변환
export function toKST(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET)
}

// KST 날짜를 UTC로 변환
export function fromKST(kstDate: Date): Date {
  return new Date(kstDate.getTime() - KST_OFFSET)
}

// KST 기준 일자 경계 (00:00:00 ~ 23:59:59.999)
export function getKSTDayBounds(targetDate: Date): { start: Date; end: Date } {
  const kstDate = toKST(targetDate)
  const startKST = new Date(kstDate.getFullYear(), kstDate.getMonth(), kstDate.getDate(), 0, 0, 0, 0)
  const endKST = new Date(kstDate.getFullYear(), kstDate.getMonth(), kstDate.getDate(), 23, 59, 59, 999)
  
  return {
    start: fromKST(startKST),
    end: fromKST(endKST)
  }
}

// KST 기준 주간 경계 (월요일 00:00 ~ 일요일 23:59)
export function getKSTWeekBounds(targetDate: Date): { start: Date; end: Date } {
  const kstDate = toKST(targetDate)
  const dayOfWeek = kstDate.getDay() // 0: 일요일, 1: 월요일, ...
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // 월요일까지의 일수
  
  const mondayKST = new Date(kstDate)
  mondayKST.setDate(kstDate.getDate() + daysToMonday)
  mondayKST.setHours(0, 0, 0, 0)
  
  const sundayKST = new Date(mondayKST)
  sundayKST.setDate(mondayKST.getDate() + 6)
  sundayKST.setHours(23, 59, 59, 999)
  
  return {
    start: fromKST(mondayKST),
    end: fromKST(sundayKST)
  }
}

// 지난주 월요일~일요일 구하기
export function getLastWeekBounds(today: Date = new Date()): { start: Date; end: Date } {
  const kstToday = toKST(today)
  const dayOfWeek = kstToday.getDay()
  const daysToLastMonday = dayOfWeek === 0 ? -13 : -6 - dayOfWeek // 지난주 월요일까지
  
  const lastMondayKST = new Date(kstToday)
  lastMondayKST.setDate(kstToday.getDate() + daysToLastMonday)
  lastMondayKST.setHours(0, 0, 0, 0)
  
  const lastSundayKST = new Date(lastMondayKST)
  lastSundayKST.setDate(lastMondayKST.getDate() + 6)
  lastSundayKST.setHours(23, 59, 59, 999)
  
  return {
    start: fromKST(lastMondayKST),
    end: fromKST(lastSundayKST)
  }
}

// 어제 구하기
export function getYesterday(today: Date = new Date()): Date {
  const kstToday = toKST(today)
  const yesterdayKST = new Date(kstToday)
  yesterdayKST.setDate(kstToday.getDate() - 1)
  return fromKST(yesterdayKST)
}

// 그저께 구하기
export function getDayBeforeYesterday(today: Date = new Date()): Date {
  const kstToday = toKST(today)
  const dayBeforeYesterdayKST = new Date(kstToday)
  dayBeforeYesterdayKST.setDate(kstToday.getDate() - 2)
  return fromKST(dayBeforeYesterdayKST)
}

// KST 날짜 포맷팅
export function formatKSTDate(date: Date): string {
  const kstDate = toKST(date)
  return kstDate.toISOString().split('T')[0] // YYYY-MM-DD
}

// KST 날짜 범위 포맷팅
export function formatKSTRange(start: Date, end: Date): string {
  return `${formatKSTDate(start)} ~ ${formatKSTDate(end)} (KST)`
}

// 날짜 문자열을 Date 객체로 파싱 (YYYY-MM-DD)
export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day) // month는 0부터 시작
}

// 실행 시간 포맷팅
export function formatExecutionTime(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}초`
}

// 통계 유틸리티
export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function std(values: number[]): number {
  if (values.length === 0) return 0
  const avg = mean(values)
  const variance = values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / values.length
  return Math.sqrt(variance)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid]
}

export function mad(values: number[], med?: number): number {
  if (values.length === 0) return 0
  const medianValue = med ?? median(values)
  const deviations = values.map(v => Math.abs(v - medianValue))
  return median(deviations)
}

// Z-score 계산
export function calculateZScore(value: number, mean: number, std: number): number {
  if (std === 0) return value > mean ? Infinity : 0
  return (value - mean) / std
}

// MAD-based score 계산 (robust z-score)
export function calculateMADScore(value: number, median: number, mad: number): number {
  if (mad === 0) return value > median ? Infinity : 0
  return (value - median) / (1.4826 * mad) // 1.4826은 정규분포 가정하에 MAD를 표준편차로 변환하는 계수
}