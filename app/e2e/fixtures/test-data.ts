import type { ContentItem, StrategyTask, Agent, Service } from '../../src/types';

export function makeContent(overrides: Partial<ContentItem> = {}): Partial<ContentItem> {
  return {
    platform: 'tiktok',
    content_type: 'wow',
    status: 'draft',
    hook: 'Test hook — AI planned my entire week in 30 seconds',
    caption: 'Test caption for E2E testing. Save this before Monday morning.',
    hashtags: ['#test', '#e2e', '#smttest'],
    content_pillar: 'ai_magic',
    post_format: 'tiktok_slideshow',
    age_range: 'toddler',
    slides: [{ slide_number: 1, text: 'Hook slide', type: 'hook' }, { slide_number: 2, text: 'Content slide', type: 'content' }],
    image_status: 'pending',
    render_status: 'pending',
    ...overrides,
  };
}

export function makeTask(overrides: Partial<StrategyTask> = {}): Partial<StrategyTask> {
  return {
    task_type: 'content_mix_change',
    title: 'Test: Increase AI Magic content',
    description: 'AI Magic posts are getting 3x engagement. Recommend increasing from 30% to 40%.',
    recommended_action: 'Update content mix directive to ai_magic=40%',
    urgency: 'normal',
    status: 'pending',
    proposed_directive: { directive: 'Set content_mix ai_magic to 40%', directive_type: 'content_mix' },
    ...overrides,
  };
}

export function makeInsight(overrides: Record<string, any> = {}) {
  return {
    insight_type: 'format_performance',
    insight: 'Test insight: Video slideshows outperform static by 3x',
    confidence: 0.65,
    status: 'confirmed',
    times_confirmed: 3,
    supporting_data: { source: 'e2e_test' },
    ...overrides,
  };
}

export function makeDirective(overrides: Record<string, any> = {}) {
  return {
    directive: 'Test directive: increase parenting_insights to 30%',
    directive_type: 'content_mix',
    target_agent: null,
    priority: 5,
    status: 'pending',
    created_by: 'e2e_test',
    ...overrides,
  };
}
