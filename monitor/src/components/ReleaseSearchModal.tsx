'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { Button, Modal, Stack, TextInput, Select, Text, List, Group } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { Platform } from '@/lib/types'

interface ReleaseOption {
  value: string
  label: string
  environments: string[]
  environmentMatched: boolean
  dateLabel: string
}

interface ReleaseSearchModalProps {
  opened: boolean
  onClose: () => void
  platform: Platform
  baseRelease: string
  onApply: (baseRelease: string, matchedRelease: string) => void
}

export default function ReleaseSearchModal({ opened, onClose, platform, baseRelease, onApply }: ReleaseSearchModalProps) {
  const [inputValue, setInputValue] = useState(baseRelease)
  const [options, setOptions] = useState<ReleaseOption[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (opened) {
      setInputValue(baseRelease)
      setOptions([])
      setSelected('')
      setError('')
    }
  }, [opened, baseRelease])

  const handleSearch = useCallback(async () => {
    if (!inputValue.trim()) {
      setError('베이스 릴리즈를 입력해주세요.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({ platform, baseRelease: inputValue.trim() })
      const response = await fetch(`/api/monitor/releases?${params.toString()}`)
      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '릴리즈 검색에 실패했습니다.')
      }

      const releases = result.data?.releases ?? []
      if (releases.length === 0) {
        setOptions([])
        setSelected('')
        setError('Production 환경에서 일치하는 릴리즈를 찾지 못했습니다.')
        return
      }

      const opts = releases.map((release: any) => {
        const date = release.dateReleased || release.dateCreated
        const dateLabel = date ? new Date(date).toLocaleString('ko-KR') : '-'
        const envLabel = release.environments?.length ? release.environments.join(', ') : 'env 정보 없음'
        const prefix = release.environmentMatched ? '★' : '•'
        return {
          value: release.version,
          label: `${prefix} ${release.version} · ${dateLabel} · ${envLabel}`,
          environments: release.environments ?? [],
          environmentMatched: release.environmentMatched,
          dateLabel
        }
      })

      setOptions(opts)
      setSelected(opts[0]?.value ?? '')
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      setError(message)
      notifications.show({ color: 'red', message: `릴리즈 검색 실패: ${message}` })
    } finally {
      setLoading(false)
    }
  }, [inputValue, platform])

  const handleApply = () => {
    if (!inputValue.trim()) {
      setError('베이스 릴리즈를 입력해주세요.')
      return
    }
    if (!selected) {
      setError('릴리즈를 선택해주세요.')
      return
    }
    onApply(inputValue.trim(), selected)
    onClose()
  }

  return (
    <Modal opened={opened} onClose={onClose} title="릴리즈 검색" centered size="lg">
      <Stack gap="md">
        <TextInput
          label="베이스 릴리즈"
          placeholder="예: 4.70.0"
          value={inputValue}
          onChange={(e) => setInputValue(e.currentTarget.value)}
          required
        />
        <Button onClick={handleSearch} loading={loading} disabled={!inputValue.trim()}>
          검색
        </Button>

        {error && <Text size="sm" c="red.6">⚠️ {error}</Text>}

        {options.length > 0 && (
          <Select
            label="검색 결과"
            data={options}
            value={selected}
            onChange={(val) => setSelected(val ?? '')}
            searchable
            nothingFoundMessage="검색 결과가 없습니다"
          />
        )}

        {options.length > 0 && selected && (
          <List size="xs" spacing="xs" icon="•">
            <List.Item>★ 표시는 지정된 환경({platform.toUpperCase()})과 일치하는 릴리즈입니다.</List.Item>
            <List.Item>발견된 환경: {options.find(option => option.value === selected)?.environments.join(', ') || '정보 없음'}</List.Item>
          </List>
        )}

        <Group justify="flex-end">
          <Button variant="light" onClick={onClose}>취소</Button>
          <Button onClick={handleApply} disabled={!selected}>적용</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
