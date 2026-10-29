'use client';
import { usePathname } from 'next/navigation';
import { useMe } from '@/components/Me';
import { currentTab, firmTabs, shownTabs } from '@/lib/nav';
import { TabBar } from '@/components/ui/TabBar';

/** The tab bar shared by People and Branding, the two pages the firm administrator looks after. */
export function FirmTabs() {
  const path = usePathname();
  const me = useMe();
  const tabs = firmTabs(me.role, me.isAdmin);
  if (!shownTabs(tabs)) return null;
  return <TabBar label="Firm sections" tabs={tabs} current={currentTab(tabs, path)} />;
}
