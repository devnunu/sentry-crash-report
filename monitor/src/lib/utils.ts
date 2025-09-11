import { clsx, type ClassValue } from 'clsx'
import { format, addDays } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Platform } from './types'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

// 날짜 포맷팅 유틸리티
export function formatKST(dateString: string): string {
  try {
    const date = new Date(dateString)
    return format(date, 'yyyy-MM-dd HH:mm', { locale: ko })
  } catch {
    return '잘못된 날짜'
  }
}

export function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    
    if (diffMs <= 0) return '만료됨'
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    
    if (diffDays > 0) {
      return `${diffDays}일 ${diffHours}시간 남음`
    } else {
      return `${diffHours}시간 남음`
    }
  } catch {
    return '알 수 없음'
  }
}

// 만료일 계산
export function calculateExpiryDate(days: number = 7): string {
  const expiryDate = addDays(new Date(), days)
  return expiryDate.toISOString()
}

// 환경 변수 검증
export function getRequiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

// 플랫폼별 환경변수 가져오기
export function getPlatformEnv(platform: Platform, key: string): string | null {
  const platformKey = `${platform.toUpperCase()}_${key}`
  return process.env[platformKey] || null
}

// 플랫폼별 필수 환경변수 가져오기
export function getRequiredPlatformEnv(platform: Platform, key: string): string {
  const value = getPlatformEnv(platform, key)
  if (!value) {
    throw new Error(`Missing required environment variable: ${platform.toUpperCase()}_${key}`)
  }
  return value
}

// 플랫폼별 환경변수 또는 기본값 가져오기
export function getPlatformEnvOrDefault(platform: Platform, key: string, defaultValue: string): string {
  return getPlatformEnv(platform, key) || defaultValue
}

// 에러 메시지 추출
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return '알 수 없는 오류가 발생했습니다'
}

// API 응답 헬퍼
export function createApiResponse<T>(data: T, success: boolean = true) {
  return {
    success,
    data
  }
}

export function createApiError(error: string, success: boolean = false) {
  return {
    success,
    error
  }
}

// 실행 시간 포맷팅 (밀리초 -> 사람이 읽기 쉬운 형태)
export function formatExecutionTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-'
  
  if (ms < 1000) return `${ms}ms`
  
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}초`
  
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}분 ${remainingSeconds}초` : `${minutes}분`
  }
  
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  
  if (remainingMinutes > 0) {
    return `${hours}시간 ${remainingMinutes}분`
  }
  return `${hours}시간`
}

// 시간 형식 검증 (HH:MM)
export function validateTimeFormat(timeString: string): boolean {
  if (!timeString) return false
  
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  return timeRegex.test(timeString)
}

// 시간을 한국어 형식으로 포맷팅
export function formatTimeKorean(timeString: string): string {
  if (!validateTimeFormat(timeString)) return timeString
  
  const [hours, minutes] = timeString.split(':').map(Number)
  const period = hours < 12 ? '오전' : '오후'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  
  return `${period} ${displayHours}시 ${minutes.toString().padStart(2, '0')}분`
}