import { useRouter, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Body, Chip, Label, Small } from '@/components/ui';
import { Raised } from '@/components/rich';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { radius, space, usePalette } from '@/theme';
import { WorkspaceSwitch, useWorkspace } from '@/workspace';

/**
 * The contents of the menu, shared by the sidebar and its fallback screen.
 *
 * Grouped rather than a flat grid: the two questions a small business actually
 * has are "am I getting paid?" and "what do I owe the ATO?", so money-in and
 * tax lead. Anything not built says Soon rather than opening a dead screen — a
 * menu that lies is worse than a short menu.
 *
 * The menu is workspace-aware, and aggressively so. A household has no
 * invoices, no customers, no stock and no BAS; showing them greyed out would
 * suggest personal use is a cut-down business account. The personal menu is
 * short because personal finance IS short — that is the feature.
 */

type Entry = {
  label: string;
  hint: string;
  icon: IconName;
  hue: string;
  href?: Href;
  soon?: boolean;
};

type Group = { title: string; entries: Entry[] };

const BUSINESS_GROUPS: Group[] = [
  {
    title: 'Money in',
    entries: [
      { label: 'New invoice', hint: 'Bill a customer now', icon: 'edit', hue: '#1878D8', href: '/invoice/new' },
      { label: 'Invoices', hint: 'Create, send and track', icon: 'doc', hue: '#2D9CDB', href: '/invoices' },
      { label: 'Estimates', hint: 'Quotes awaiting approval', icon: 'edit', hue: '#5B6EF5', href: '/invoices?kind=estimate' },
      { label: 'Customers', hint: 'Who owes you what', icon: 'users', hue: '#27AE60', href: '/parties?kind=customer' },
      { label: 'Payments', hint: 'Record money received', icon: 'wallet', hue: '#F2994A', href: '/payments' },
    ],
  },
  {
    title: 'Money out',
    entries: [
      { label: 'Receipts', hint: 'Everything you have scanned', icon: 'receipt', hue: '#1CA8DB', href: '/receipts' },
      { label: 'Suppliers', hint: 'Who you buy from', icon: 'truck', hue: '#9B6BF2', href: '/parties?kind=supplier' },
      { label: 'Bills', hint: 'Purchase invoices to pay', icon: 'download', hue: '#EF6C7E', href: '/bills' },
      { label: 'Mileage', hint: 'Log trips for D1', icon: 'road', hue: '#4FC3C7', href: '/mileage' },
    ],
  },
  {
    title: 'Stock',
    entries: [
      { label: 'Items', hint: 'Products and services', icon: 'box', hue: '#F2994A', href: '/items' },
      { label: 'Stock take', hint: 'Count and adjust', icon: 'grid', hue: '#6C8AE4', href: '/stocktake' },
    ],
  },
  {
    title: 'Tax & reports',
    entries: [
      { label: 'Tax & BAS', hint: 'GST position and deductions', icon: 'report', hue: '#1878D8', href: '/tax' },
      { label: 'Analytics', hint: 'Where the money went', icon: 'chart', hue: '#5B6EF5', href: '/analytics' },
      { label: 'Reports', hint: 'Profit, spending, daybook', icon: 'report', hue: '#27AE60', href: '/reports' },
      { label: 'Tax pack', hint: 'Export for your accountant', icon: 'upload', hue: '#9B6BF2', href: '/taxpack' },
      { label: 'Xero sync', hint: 'Push to your ledger', icon: 'link', hue: '#2D9CDB', href: '/connections' },
    ],
  },
  {
    title: 'Workspace',
    entries: [
      { label: 'People', hint: 'Who is in this workspace', icon: 'users', hue: '#1878D8', href: '/members' },
      { label: 'Business', hint: 'ABN, GST basis, occupation', icon: 'building', hue: '#55677E', href: '/settings' },
      { label: 'Categories', hint: 'How spending is sorted', icon: 'tag', hue: '#EF6C7E', href: '/categories' },
      { label: 'Credits', hint: 'Scans this workspace has bought or been given', icon: 'card', hue: '#1878D8', href: '/credits' },
      { label: 'Points', hint: 'Yours, earned by scanning', icon: 'spark', hue: '#9B6BF2', href: '/points' },
      // NOT 'Credits'. `/credits` above is the balance, the packs and the
      // purchase history; this screen is THIS MONTH'S USAGE — scans used, and
      // what happens if you run out. Both were labelled 'Credits' after the
      // subscription was dropped and 'Plan' was relabelled without noticing the
      // entry above already existed, so the menu showed the same word twice
      // pointing at two different screens.
      { label: 'Usage', hint: 'Scans used this month', icon: 'star', hue: '#F2994A', href: '/plan' },
    ],
  },
];

const PERSONAL_GROUPS: Group[] = [
  {
    title: 'Spending',
    entries: [
      { label: 'All spending', hint: 'Everything you have scanned', icon: 'receipt', hue: '#1CA8DB', href: '/receipts' },
      { label: 'Analytics', hint: 'Where the money went', icon: 'chart', hue: '#5B6EF5', href: '/analytics' },
      { label: 'Budgets', hint: 'What each category allows', icon: 'target', hue: '#3BA55C', href: '/budgets' },
    ],
  },
  {
    title: 'Planning',
    entries: [
      { label: 'Recurring', hint: 'Subscriptions and standing bills', icon: 'repeat', hue: '#6C8AE4', href: '/recurring' },
      { label: 'Savings goals', hint: 'Put a name on it', icon: 'bank', hue: '#F2994A', href: '/goals' },
    ],
  },
  {
    title: 'Your account',
    entries: [
      { label: 'Credits', hint: 'Scans you have bought or been given', icon: 'card', hue: '#1878D8', href: '/credits' },
      { label: 'Points', hint: 'Earned by scanning', icon: 'spark', hue: '#9B6BF2', href: '/points' },
      { label: 'Rewards', hint: 'Trade points for scan credits', icon: 'star', hue: '#F2994A', href: '/rewards' },
      { label: 'Purchases', hint: 'Every top up and its status', icon: 'doc', hue: '#2D9CDB', href: '/orders' },
      // NOT 'Credits'. `/credits` above is the balance, the packs and the
      // purchase history; this screen is THIS MONTH'S USAGE — scans used, and
      // what happens if you run out. Both were labelled 'Credits' after the
      // subscription was dropped and 'Plan' was relabelled without noticing the
      // entry above already existed, so the menu showed the same word twice
      // pointing at two different screens.
      { label: 'Usage', hint: 'Scans used this month', icon: 'star', hue: '#F2994A', href: '/plan' },
    ],
  },
  {
    title: 'Household',
    entries: [
      { label: 'People', hint: 'Share with your family', icon: 'users', hue: '#1878D8', href: '/members' },
      { label: 'Categories', hint: 'How spending is sorted', icon: 'tag', hue: '#9B6BF2', href: '/categories' },
      { label: 'Settings', hint: 'Workspace and privacy', icon: 'cog', hue: '#55677E', href: '/settings' },
    ],
  },
  {
    title: 'App',
    entries: [
      { label: 'Notifications', hint: 'What we are allowed to tell you', icon: 'bell', hue: '#5B6EF5', href: '/notifications' },
      { label: 'Privacy and data', hint: 'What is kept, and for how long', icon: 'shield', hue: '#1B6E4F', href: '/privacy' },
      { label: 'Export receipts', hint: 'Take everything with you', icon: 'upload', hue: '#4FC3C7', href: '/export' },
      { label: 'Help', hint: 'Answers, and how to reach us', icon: 'help', hue: '#6C8AE4', href: '/help' },
    ],
  },
];

export function MenuContent({ onNavigate }: { onNavigate?: () => void }) {
  const p = usePalette();
  const router = useRouter();
  const { isBusiness } = useWorkspace();
  // The one place this flag is checked to pick a menu: everywhere else reads
  // `isBusiness`, which the workspace provider already keeps honest — a
  // personal-only build never has a business workspace to be active.
  const groups = BUSINESS_FEATURES_ENABLED && isBusiness ? BUSINESS_GROUPS : PERSONAL_GROUPS;

  return (
    <View style={{ gap: space.lg }}>
      <WorkspaceSwitch />

      {groups.map((group) => (
        <View key={group.title} style={{ gap: space.sm }}>
          <Label>{group.title}</Label>
          <Raised style={{ padding: 0 }}>
            {group.entries.map((e, i) => (
              <Pressable
                key={e.label}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!e.soon }}
                onPress={() => {
                  if (!e.href) return;
                  onNavigate?.();
                  router.push(e.href);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  paddingVertical: 13,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: p.rule,
                  backgroundColor: pressed && !e.soon ? p.surfaceAlt : 'transparent',
                  opacity: e.soon ? 0.55 : 1,
                })}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.md,
                    backgroundColor: `${e.hue}30`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={e.icon} size={19} color={e.hue} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Body strong>{e.label}</Body>
                  <Small numberOfLines={1}>{e.hint}</Small>
                </View>
                {e.soon ? <Chip>Soon</Chip> : <Icon name="chevronRight" size={18} color={p.inkFaint} />}
              </Pressable>
            ))}
          </Raised>
        </View>
      ))}
    </View>
  );
}
