import { monitoringService } from './monitor'
import { db } from './database'

interface LocalRunnerEntry {
  intervalId: NodeJS.Timeout
  intervalMinutes: number
  inFlight: boolean
}

const runners = new Map<string, LocalRunnerEntry>()

function isDevEnv() {
  return process.env.NODE_ENV === 'development'
}

async function runTick(monitorId: string, intervalMinutes: number) {
  try {
    console.log(`🧪 [LocalRunner] ${monitorId} 즉시 실행 (간격 ${intervalMinutes}분)`) 
    await monitoringService.executeSpecificMonitor(monitorId, intervalMinutes)
  } catch (error) {
    console.error(`🧪 [LocalRunner] ${monitorId} 실행 실패:`, error)
  }
}

export function startLocalMonitorRunner(monitorId: string, intervalMinutes: number) {
  if (!isDevEnv()) return

  stopLocalMonitorRunner(monitorId)

  const safeInterval = Math.max(1, intervalMinutes)
    const entry: LocalRunnerEntry = {
      intervalId: setInterval(async () => {
        const current = runners.get(monitorId)
        if (!current) {
          return
        }
        if (current.inFlight) {
          console.log(`🧪 [LocalRunner] ${monitorId} 이전 실행 대기 중, 이번 회차 건너뜀`)
          return
        }
        current.inFlight = true
        try {
          const monitor = await db.getMonitorSession(monitorId)
          if (!monitor || monitor.status !== 'active') {
            console.log(`🧪 [LocalRunner] ${monitorId} 상태(${monitor?.status ?? '없음'}) → 러너 종료`)
            stopLocalMonitorRunner(monitorId)
            return
          }
          await monitoringService.executeMonitor(monitor, safeInterval)
        } catch (error) {
          console.error(`🧪 [LocalRunner] ${monitorId} 실행 실패:`, error)
        } finally {
          const latest = runners.get(monitorId)
          if (latest) {
            latest.inFlight = false
          }
        }
      }, safeInterval * 60 * 1000),
      intervalMinutes: safeInterval,
      inFlight: false,
    }

  runners.set(monitorId, entry)
  console.log(`🧪 [LocalRunner] ${monitorId} 로컬 주기 실행 시작 (${safeInterval}분 간격)`) 
}

export function stopLocalMonitorRunner(monitorId: string) {
  if (!isDevEnv()) return
  const entry = runners.get(monitorId)
  if (entry) {
    clearInterval(entry.intervalId)
    runners.delete(monitorId)
    console.log(`🧪 [LocalRunner] ${monitorId} 로컬 주기 실행 종료`)
  }
}

export function stopAllLocalMonitorRunners() {
  if (!isDevEnv()) return
  for (const monitorId of runners.keys()) {
    stopLocalMonitorRunner(monitorId)
  }
}

// 개발 서버 종료 시 정리
if (isDevEnv()) {
  process.on('SIGINT', () => {
    stopAllLocalMonitorRunners()
  })
  process.on('exit', () => {
    stopAllLocalMonitorRunners()
  })
}
