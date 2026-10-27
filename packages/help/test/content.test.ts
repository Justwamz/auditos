import { describe, expect, test } from 'vitest';
import { ARTICLES, chunksOf, forTopic, listFor, searchHelp, visibleTo } from '../src';
import type { Audience } from '../src';

const AUDIENCES: Audience[] = ['all', 'admin', 'firm_admin', 'partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'];
const ROLES = ['firm_admin', 'partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'];

describe('help content', () => {
  test('ids are unique, kebab-case and every article is complete', () => {
    const ids = ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ARTICLES) {
      expect(a.id, a.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(a.title.trim().length, a.id).toBeGreaterThan(5);
      expect(a.summary.trim().length, a.id).toBeGreaterThan(15);
      expect(a.category.trim().length, a.id).toBeGreaterThan(2);
      expect(a.body.trim().length, a.id).toBeGreaterThan(200);
      expect(a.audience.length, a.id).toBeGreaterThan(0);
      for (const x of a.audience) expect(AUDIENCES, `${a.id}: ${x}`).toContain(x);
      expect(a.tags.length, a.id).toBeGreaterThan(0);
    }
  });

  test('every article splits into sections with text', () => {
    for (const a of ARTICLES) {
      const chunks = chunksOf(a);
      expect(chunks.length, a.id).toBeGreaterThanOrEqual(2);
      for (const c of chunks) expect(c.text.length, `${a.id}/${c.section}`).toBeGreaterThan(20);
    }
  });

  test('every role has a useful set of articles, including the start page and the visibility rules', () => {
    for (const role of ROLES) {
      const seen = visibleTo(ARTICLES, { role, isAdmin: role === 'firm_admin' }).map((a) => a.id);
      expect(seen, role).toContain('start-here');
      expect(seen, role).toContain('who-sees-what');
      expect(seen.length, role).toBeGreaterThanOrEqual(8);
    }
  });

  test('guidance is role-specific: staff do not get approval or administration guides, administrators do not get review guides', () => {
    const staff = visibleTo(ARTICLES, { role: 'staff', isAdmin: false }).map((a) => a.id);
    for (const hidden of ['review-sign-off', 'approve-issue-lock', 'engagement-stages', 'people-and-access', 'audit-trail-reading', 'partner-view-only', 'handover-leavers', 'change-account-manager', 'invoices-and-tax', 'billing-dashboard', 'quotations-using', 'rates-taxes-settings']) {
      expect(staff, hidden).not.toContain(hidden);
    }
    const admin = visibleTo(ARTICLES, { role: 'firm_admin', isAdmin: true }).map((a) => a.id);
    for (const hidden of ['review-sign-off', 'approve-issue-lock', 'papers-prepare', 'checklists-answering', 'personal-details', 'pipeline-prospects', 'calendar-using', 'timesheet-time-expenses']) {
      expect(admin, hidden).not.toContain(hidden);
    }
    expect(admin).toContain('people-and-access');
  });

  test('a page opened by a role has help for it ("?" never leads nowhere)', () => {
    const pages: { topic: string; roles: string[] }[] = [
      { topic: 'dashboard', roles: ROLES },
      { topic: 'clients', roles: ROLES },
      { topic: 'clients.contacts', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'audit-trail', roles: ['partner', 'manager', 'firm_admin'] },
      { topic: 'admin.users', roles: ['firm_admin'] },
      { topic: 'engagement.overview', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'engagement.checklists', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'engagement.papers', roles: ['senior', 'staff'] },
      { topic: 'engagement.papers.materiality', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'engagement.evidence', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'engagement.financials', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'paper.history', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'independence', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'engagements.new', roles: ['partner', 'manager'] },
      { topic: 'engagement.stage', roles: ['partner', 'manager'] },
      { topic: 'pipeline', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'calendar', roles: ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'] },
      { topic: 'clients.manager', roles: ['partner'] },
      { topic: 'admin.handover', roles: ['firm_admin'] },
      { topic: 'timesheet', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'billing', roles: ['partner', 'manager', 'firm_admin'] },
      { topic: 'invoices', roles: ['partner', 'manager', 'firm_admin'] },
      { topic: 'quotes', roles: ['partner', 'manager', 'firm_admin'] },
      { topic: 'billing.settings', roles: ['partner', 'manager', 'firm_admin'] },
      { topic: 'billing.fee', roles: ['partner', 'manager'] },
      { topic: 'invoices.tax', roles: ['partner', 'manager', 'firm_admin'] },
      { topic: 'engagement.bank-statements', roles: ['partner', 'manager', 'senior', 'staff'] },
      { topic: 'engagement.sampling', roles: ['partner', 'manager', 'senior', 'staff'] },
    ];
    for (const p of pages) {
      for (const role of p.roles) {
        expect(forTopic(ARTICLES, { role, isAdmin: role === 'firm_admin' }, p.topic).length, `${p.topic} for ${role}`).toBeGreaterThan(0);
      }
    }
  });

  test('plain questions find the right guide for the right person', () => {
    const top = (role: string, q: string, isAdmin = false) => searchHelp(ARTICLES, { role, isAdmin }, q)[0]?.articleId;
    expect(top('manager', 'how do I sign off a paper')).toBe('review-sign-off');
    expect(top('staff', 'how do I upload a receipt')).toBe('evidence-files');
    expect(top('partner', 'how do I lock the engagement')).toBe('approve-issue-lock');
    expect(top('firm_admin', 'invite a new person', true)).toBe('people-and-access');
    expect(top('staff', 'reveal phone number')).toBe('personal-details');
    expect(top('manager', 'cannot move to the next stage')).toBe('cannot-move-stage');
    expect(top('staff', 'what is materiality')).toBe('materiality');
    expect(top('staff', 'how do I log my hours')).toBe('timesheet-time-expenses');
    expect(top('manager', 'add VAT to an invoice')).toBe('invoices-and-tax');
    expect(top('partner', 'is the invoice a valid KRA tax invoice')).toBe('kra-etims-simulation');
    expect(top('manager', 'convert a prospect into a client')).toBe('pipeline-prospects');
    expect(top('staff', 'schedule fieldwork on the calendar')).toBe('calendar-using');
    expect(top('firm_admin', 'someone is leaving, switch them off', true)).toBe('handover-leavers');
    expect(top('staff', 'the bank statement pdf asks for a password')).toBe('bank-statements-upload');
    expect(top('manager', 'duplicate payments and returned cheques on the bank statement')).toBe('bank-statements-analysis');
    expect(top('senior', 'how do I pick a random sample of invoices to test')).toBe('sampling-using');
  });

  test('a search by staff never returns the partner-only or admin-only guides', () => {
    const forbidden = new Set(['review-sign-off', 'approve-issue-lock', 'engagement-stages', 'people-and-access', 'audit-trail-reading', 'partner-view-only', 'engagement-stages', 'cannot-move-stage', 'managing-an-engagement']);
    for (const q of ['approve', 'lock the file', 'invite person', 'audit trail', 'stage gate blocked', 'review sign off', 'partner', 'administrator']) {
      for (const h of searchHelp(ARTICLES, { role: 'staff', isAdmin: false }, q, { limit: 50 })) expect(forbidden.has(h.articleId), `${q} -> ${h.articleId}`).toBe(false);
    }
  });

  test('the browse list is grouped and complete for the role', () => {
    const list = listFor(ARTICLES, { role: 'manager', isAdmin: false });
    expect(list.length).toBeGreaterThanOrEqual(3);
    const count = list.reduce((n, g) => n + g.articles.length, 0);
    expect(count).toBe(visibleTo(ARTICLES, { role: 'manager', isAdmin: false }).length);
  });
});
