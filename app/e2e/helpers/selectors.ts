export const sel = {
  // Layout
  sidebar: 'aside',
  topBar: '.sticky',
  notificationBell: 'button[title="Notifications"]',
  refreshButton: 'button[title="Refresh all data"]',

  // Navigation
  navDashboard: 'a[href="/"]',
  navPipeline: 'a[href="/pipeline"]',
  navStrategy: 'a[href="/strategy"]',
  navResearch: 'a[href="/research"]',
  navPlanner: 'a[href="/planner"]',
  navRenders: 'a[href="/renders"]',
  navAnalytics: 'a[href="/analytics"]',
  navActivity: 'a[href="/activity"]',
  navAgents: 'a[href="/system/agents"]',
  navServices: 'a[href="/system/services"]',
  navProfiles: 'a[href="/system/profiles"]',
  navDirectives: 'a[href="/system/directives"]',
  navCosts: 'a[href="/system/costs"]',

  // Pipeline
  pipelineSearch: 'input[placeholder*="Search"]',
  pipelineTab: (name: string) => `button:has-text("${name}")`,
  contentRow: (hook: string) => `button:has-text("${hook}")`,
  checkboxAll: 'input[type="checkbox"]:first-of-type',

  // Buttons
  approveBtn: 'button[title="Approve"]',
  rejectBtn: 'button[title="Reject"]',
  viewBtn: 'button[title="View"]',
};
