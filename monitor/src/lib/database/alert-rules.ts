// Alert Rules 데이터베이스 함수

import { supabaseAdmin } from '../supabase';
import type { AlertRule, AlertCondition, AlertCategory } from '../types/alert-rules';

export class AlertRulesDb {
  private ensureSupabaseAdmin() {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client is not configured');
    }
    return supabaseAdmin;
  }

  // 규칙 목록 조회
  async getAlertRules(category?: AlertCategory): Promise<AlertRule[]> {
    const admin = this.ensureSupabaseAdmin();

    // 먼저 규칙들을 가져옴
    let rulesQuery = admin
      .from('alert_rules')
      .select('*')
      .order('category')
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false });

    if (category) {
      rulesQuery = rulesQuery.eq('category', category);
    }

    const { data: rules, error: rulesError } = await rulesQuery;

    if (rulesError) {
      throw new Error(`Failed to fetch rules: ${rulesError.message}`);
    }

    if (!rules || rules.length === 0) {
      return [];
    }

    // 각 규칙의 조건들을 가져옴
    const { data: conditions, error: conditionsError } = await admin
      .from('alert_conditions')
      .select('*')
      .in(
        'rule_id',
        rules.map((r) => r.id)
      )
      .order('position');

    if (conditionsError) {
      throw new Error(`Failed to fetch conditions: ${conditionsError.message}`);
    }

    // 규칙과 조건 매핑
    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      category: rule.category,
      severity: rule.severity,
      enabled: rule.enabled,
      conditionOperator: rule.condition_operator,
      conditions: (conditions || [])
        .filter((c) => c.rule_id === rule.id)
        .map((c) => ({
          id: c.id,
          ruleId: c.rule_id,
          metric: c.metric,
          operator: c.operator,
          threshold: c.threshold,
          params: c.params || {},
          position: c.position
        })),
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
      createdBy: rule.created_by
    }));
  }

  // 규칙 단일 조회
  async getAlertRule(id: string): Promise<AlertRule | null> {
    const admin = this.ensureSupabaseAdmin();

    const { data: rule, error: ruleError } = await admin
      .from('alert_rules')
      .select('*')
      .eq('id', id)
      .single();

    if (ruleError || !rule) {
      return null;
    }

    const { data: conditions, error: conditionsError } = await admin
      .from('alert_conditions')
      .select('*')
      .eq('rule_id', id)
      .order('position');

    if (conditionsError) {
      throw new Error(`Failed to fetch conditions: ${conditionsError.message}`);
    }

    return {
      id: rule.id,
      name: rule.name,
      category: rule.category,
      severity: rule.severity,
      enabled: rule.enabled,
      conditionOperator: rule.condition_operator,
      conditions: (conditions || []).map((c) => ({
        id: c.id,
        ruleId: c.rule_id,
        metric: c.metric,
        operator: c.operator,
        threshold: c.threshold,
        params: c.params || {},
        position: c.position
      })),
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
      createdBy: rule.created_by
    };
  }

  // 규칙 생성
  async createAlertRule(params: {
    name: string;
    category: AlertCategory;
    severity: 'warning' | 'critical';
    enabled: boolean;
    conditionOperator: 'AND' | 'OR';
    conditions: Array<{
      metric: string;
      operator: string;
      threshold: number;
      params?: Record<string, any>;
      position: number;
    }>;
    createdBy?: string;
  }): Promise<AlertRule> {
    const admin = this.ensureSupabaseAdmin();

    // 규칙 생성
    const { data: rule, error: ruleError } = await admin
      .from('alert_rules')
      .insert({
        name: params.name,
        category: params.category,
        severity: params.severity,
        enabled: params.enabled,
        condition_operator: params.conditionOperator,
        created_by: params.createdBy || 'system'
      })
      .select()
      .single();

    if (ruleError || !rule) {
      throw new Error(`Failed to create rule: ${ruleError?.message}`);
    }

    // 조건 생성
    const conditionsToInsert = params.conditions.map((c) => ({
      rule_id: rule.id,
      metric: c.metric,
      operator: c.operator,
      threshold: c.threshold,
      params: c.params || {},
      position: c.position
    }));

    const { data: conditions, error: conditionsError } = await admin
      .from('alert_conditions')
      .insert(conditionsToInsert)
      .select();

    if (conditionsError) {
      // 롤백을 위해 규칙 삭제
      await admin.from('alert_rules').delete().eq('id', rule.id);
      throw new Error(`Failed to create conditions: ${conditionsError.message}`);
    }

    return {
      id: rule.id,
      name: rule.name,
      category: rule.category,
      severity: rule.severity,
      enabled: rule.enabled,
      conditionOperator: rule.condition_operator,
      conditions: (conditions || []).map((c) => ({
        id: c.id,
        ruleId: c.rule_id,
        metric: c.metric,
        operator: c.operator,
        threshold: c.threshold,
        params: c.params || {},
        position: c.position
      })),
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
      createdBy: rule.created_by
    };
  }

  // 규칙 수정
  async updateAlertRule(
    id: string,
    params: {
      name?: string;
      enabled?: boolean;
      conditionOperator?: 'AND' | 'OR';
      conditions?: Array<{
        metric: string;
        operator: string;
        threshold: number;
        params?: Record<string, any>;
        position: number;
      }>;
    }
  ): Promise<AlertRule> {
    const admin = this.ensureSupabaseAdmin();

    // 규칙 업데이트
    const updateData: any = { updated_at: new Date().toISOString() };

    if (params.name !== undefined) {
      updateData.name = params.name;
    }
    if (params.enabled !== undefined) {
      updateData.enabled = params.enabled;
    }
    if (params.conditionOperator !== undefined) {
      updateData.condition_operator = params.conditionOperator;
    }

    const { error: updateError } = await admin
      .from('alert_rules')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      throw new Error(`Failed to update rule: ${updateError.message}`);
    }

    // 조건 업데이트
    if (params.conditions) {
      // 기존 조건 삭제
      const { error: deleteError } = await admin
        .from('alert_conditions')
        .delete()
        .eq('rule_id', id);

      if (deleteError) {
        throw new Error(`Failed to delete old conditions: ${deleteError.message}`);
      }

      // 새 조건 삽입
      const conditionsToInsert = params.conditions.map((c) => ({
        rule_id: id,
        metric: c.metric,
        operator: c.operator,
        threshold: c.threshold,
        params: c.params || {},
        position: c.position
      }));

      const { error: insertError } = await admin
        .from('alert_conditions')
        .insert(conditionsToInsert);

      if (insertError) {
        throw new Error(`Failed to insert new conditions: ${insertError.message}`);
      }
    }

    // 업데이트된 규칙 반환
    const result = await this.getAlertRule(id);
    if (!result) throw new Error('Failed to fetch updated rule');
    return result;
  }

  // 규칙 삭제
  async deleteAlertRule(id: string): Promise<void> {
    const admin = this.ensureSupabaseAdmin();

    const { error } = await admin.from('alert_rules').delete().eq('id', id);

    if (error) {
      throw new Error(`Failed to delete rule: ${error.message}`);
    }
  }

  // 규칙 활성화/비활성화
  async toggleAlertRule(id: string, enabled: boolean): Promise<void> {
    const admin = this.ensureSupabaseAdmin();

    const { error } = await admin
      .from('alert_rules')
      .update({
        enabled,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to toggle rule: ${error.message}`);
    }
  }
}

export const alertRulesDb = new AlertRulesDb();
