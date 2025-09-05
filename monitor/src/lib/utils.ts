import { clsx, type ClassValue } from 'clsx'
import { format, addDays } from 'date-fns'
import { ko } from 'date-fns/locale'

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