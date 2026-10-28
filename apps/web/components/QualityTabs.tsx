'use client';
import { usePathname } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { currentTab, qualityTabs } from '@/lib/nav';
import { TabBar } from '@/components/ui/TabBar';

interface Me { role: string | null; isAdmin: boolean }

/** The tab bar shared by the independence and activity history pages. */
export function QualityTabs() {
  const path = usePathname();
  const me = useApi<Me>('/me');
  if (!me.data?.role) return null;
  const tabs = qualityTabs(me.data.role, me.data.isAdmin);
  return <TabBar label="Quality sections" tabs={tabs} current={currentTab(tabs, path)} />;
}
