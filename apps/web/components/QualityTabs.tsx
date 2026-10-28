'use client';
import { usePathname } from 'next/navigation';
import { useMe } from '@/components/Me';
import { currentTab, qualityTabs, shownTabs } from '@/lib/nav';
import { TabBar } from '@/components/ui/TabBar';

/** The tab bar shared by the independence and activity history pages. */
export function QualityTabs() {
  const path = usePathname();
  const me = useMe();
  const tabs = qualityTabs(me.role, me.isAdmin);
  if (!shownTabs(tabs)) return null;
  return <TabBar label="Quality sections" tabs={tabs} current={currentTab(tabs, path)} />;
}
