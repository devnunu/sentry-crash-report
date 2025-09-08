import * as cron from 'node-cron'

class DevCronService {
  private tasks: cron.ScheduledTask[] = []
  private isRunning = false

  start() {
    if (this.isRunning || process.env.NODE_ENV !== 'development') {
      return
    }

    console.log('🚀 Starting development cron service...')
    this.isRunning = true

    // 일간 리포트 스케줄 (매분 실행)
    const dailyTask = cron.schedule('* * * * *', async () => {
      try {
        console.log('⏰ [DEV CRON] Checking daily report schedule...')
        
        const response = await fetch('http://localhost:3000/api/reports/daily/schedule', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })

        const result = await response.json()
        
        if (result.success) {
          if (result.data.skipped) {
            console.log(`📋 [DEV CRON] Daily report skipped: ${result.data.message}`)
          } else {
            console.log(`✅ [DEV CRON] Daily report executed: ${result.data.message}`)
            console.log(`   Execution ID: ${result.data.executionId}`)
          }
        } else {
          console.error(`❌ [DEV CRON] Daily report failed: ${result.error}`)
        }
      } catch (error) {
        console.error('❌ [DEV CRON] Daily report API call failed:', error)
      }
    }, {
      scheduled: false // 수동으로 시작
    })

    // 주간 리포트 스케줄 (매분 실행)
    const weeklyTask = cron.schedule('* * * * *', async () => {
      try {
        console.log('⏰ [DEV CRON] Checking weekly report schedule...')
        
        const response = await fetch('http://localhost:3000/api/reports/weekly/schedule', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })

        const result = await response.json()
        
        if (result.success) {
          if (result.data.skipped) {
            console.log(`📋 [DEV CRON] Weekly report skipped: ${result.data.message}`)
          } else {
            console.log(`✅ [DEV CRON] Weekly report executed: ${result.data.message}`)
            console.log(`   Execution ID: ${result.data.executionId}`)
          }
        } else {
          console.error(`❌ [DEV CRON] Weekly report failed: ${result.error}`)
        }
      } catch (error) {
        console.error('❌ [DEV CRON] Weekly report API call failed:', error)
      }
    }, {
      scheduled: false // 수동으로 시작
    })

    // 기존 모니터 틱 스케줄 (30분마다)
    const monitorTask = cron.schedule('*/30 * * * *', async () => {
      try {
        console.log('⏰ [DEV CRON] Checking monitor tick...')
        
        const response = await fetch('http://localhost:3000/api/monitor/tick', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })

        const result = await response.json()
        
        if (result.success) {
          console.log(`✅ [DEV CRON] Monitor tick completed`)
        } else {
          console.error(`❌ [DEV CRON] Monitor tick failed: ${result.error}`)
        }
      } catch (error) {
        console.error('❌ [DEV CRON] Monitor tick API call failed:', error)
      }
    }, {
      scheduled: false // 수동으로 시작
    })

    this.tasks = [dailyTask, weeklyTask, monitorTask]
    
    // 모든 태스크 시작
    this.tasks.forEach(task => task.start())
    
    console.log(`✅ Development cron service started with ${this.tasks.length} tasks`)
    console.log('   - Daily report: Every minute')
    console.log('   - Weekly report: Every minute') 
    console.log('   - Monitor tick: Every 30 minutes')
  }

  stop() {
    if (!this.isRunning) {
      return
    }

    console.log('🛑 Stopping development cron service...')
    
    this.tasks.forEach(task => {
      task.stop()
      task.destroy()
    })
    
    this.tasks = []
    this.isRunning = false
    
    console.log('✅ Development cron service stopped')
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      tasksCount: this.tasks.length,
      environment: process.env.NODE_ENV
    }
  }

  // 수동으로 특정 스케줄 트리거
  async triggerDaily() {
    console.log('🔧 [MANUAL TRIGGER] Triggering daily report...')
    try {
      const response = await fetch('http://localhost:3000/api/reports/daily/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const result = await response.json()
      console.log('🔧 [MANUAL TRIGGER] Daily result:', result)
      return result
    } catch (error) {
      console.error('🔧 [MANUAL TRIGGER] Daily error:', error)
      throw error
    }
  }

  async triggerWeekly() {
    console.log('🔧 [MANUAL TRIGGER] Triggering weekly report...')
    try {
      const response = await fetch('http://localhost:3000/api/reports/weekly/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const result = await response.json()
      console.log('🔧 [MANUAL TRIGGER] Weekly result:', result)
      return result
    } catch (error) {
      console.error('🔧 [MANUAL TRIGGER] Weekly error:', error)
      throw error
    }
  }
}

// 싱글톤 인스턴스
export const devCronService = new DevCronService()

// 프로세스 종료 시 정리
if (process.env.NODE_ENV === 'development') {
  process.on('SIGINT', () => {
    devCronService.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    devCronService.stop()
    process.exit(0)
  })
}