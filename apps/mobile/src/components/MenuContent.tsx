import { useRouter, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from '@/theme/text';

import { Icon, type IconName } from '@/components/Icon';
import { Chip, Section, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { space, type, usePalette } from '@/theme';
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
 *
 * Each entry used to carry a `hue` that tinted its icon tile. Forty pastel
 * squares in a column was the loudest template tell left in the app, and the
 * hues encoded nothing a reader could learn, so the
 * field is gone: an entry is an ink icon, a label and a hint, grouped under a
 * mono label with a hairline between rows.
 */

type Entry = {
  label: string;
  hint: string;
  icon: IconName;
  href?: Href;
  soon?: boolean;
};

type Group = { title: string; entries: Entry[] };

const BUSINESS_GROUPS: Group[] = [
  {
    title: 'Money in',
    entries: [
      { label: 'New invoice', hint: 'Bill a customer now', icon: 'edit', href: '/invoice/new' },
      { label: 'Invoices', hint: 'Create, send and track', icon: 'doc', href: '/invoices' },
      { label: 'Estimates', hint: 'Quotes awaiting approval', icon: 'edit', href: '/invoices?kind=estimate' },
      { label: 'Customers', hint: 'Who owes you what', icon: 'users', href: '/parties?kind=customer' },
      { label: 'Payments', hint: 'Record money received', icon: 'wallet', href: '/payments' },
    ],
  },
  {
    title: 'Money out',
    entries: [
      { label: 'Receipts', hint: 'Everything you have scanned', icon: 'receipt', href: '/receipts' },
      { label: 'Suppliers', hint: 'Who you buy from', icon: 'truck', href: '/parties?kind=supplier' },
      { label: 'Bills', hint: 'Purchase invoices to pay', icon: 'download', href: '/bills' },
      { label: 'Mileage', hint: 'Log trips for D1', icon: 'road', href: '/mileage' },
    ],
  },
  {
    title: 'Stock',
    entries: [
      { label: 'Items', hint: 'Products and services', icon: 'box', href: '/items' },
      { label: 'Stock take', hint: 'Count and adjust', icon: 'grid', href: '/stocktake' },
    ],
  },
  {
    title: 'Tax & reports',
    entries: [
      { label: 'Tax & BAS', hint: 'GST position and deductions', icon: 'report', href: '/tax' },
      { label: 'Analytics', hint: 'Where the money went', icon: 'chart', href: '/analytics' },
      { label: 'Reports', hint: 'Profit, spending, daybook', icon: 'report', href: '/reports' },
      { label: 'Tax pack', hint: 'Export for your accountant', icon: 'upload', href: '/taxpack' },
      { label: 'Xero sync', hint: 'Push to your ledger', icon: 'link', href: '/connections' },
    ],
  },
  {
    title: 'Workspace',
    entries: [
      { label: 'People', hint: 'Who is in this workspace', icon: 'users', href: '/members' },
      { label: 'Business', hint: 'ABN, GST basis, occupation', icon: 'building', href: '/settings' },
      { label: 'Categories', hint: 'How spending is sorted', icon: 'tag', href: '/categories' },
      { label: 'Credits', hint: 'Scans this workspace has bought or been given', icon: 'card', href: '/credits' },
      { label: 'Points', hint: 'Yours, earned by scanning', icon: 'spark', href: '/points' },
      // NOT 'Credits'. `/credits` above is the balance, the packs and the
      // purchase history; this screen is THIS MONTH'S USAGE — scans used, and
      // what happens if you run out. Both were labelled 'Credits' after the
      // subscription was dropped and 'Plan' was relabelled without noticing the
      // entry above already existed, so the menu showed the same word twice
      // pointing at two different screens.
      { label: 'Usage', hint: 'Scans used this month', icon: 'star', href: '/plan' },
    ],
  },
];

const PERSONAL_GROUPS: Group[] = [
  {
    title: 'Spending',
    entries: [
      { label: 'All spending', hint: 'Everything you have scanned', icon: 'receipt', href: '/receipts' },
      { label: 'Analytics', hint: 'Where the money went', icon: 'chart', href: '/analytics' },
      { label: 'Budgets', hint: 'What each category allows', icon: 'target', href: '/budgets' },
    ],
  },
  {
    title: 'Planning',
    entries: [
      { label: 'Recurring', hint: 'Subscriptions and standing bills', icon: 'repeat', href: '/recurring' },
      { label: 'Savings goals', hint: 'Put a name on it', icon: 'bank', href: '/goals' },
    ],
  },
  {
    title: 'Your account',
    entries: [
      { label: 'Credits', hint: 'Scans you have bought or been given', icon: 'card', href: '/credits' },
      { label: 'Points', hint: 'Earned by scanning', icon: 'spark', href: '/points' },
      { label: 'Rewards', hint: 'Trade points for scan credits', icon: 'star', href: '/rewards' },
      { label: 'Purchases', hint: 'Every top up and its status', icon: 'doc', href: '/orders' },
      // NOT 'Credits'. `/credits` above is the balance, the packs and the
      // purchase history; this screen is THIS MONTH'S USAGE — scans used, and
      // what happens if you run out. Both were labelled 'Credits' after the
      // subscription was dropped and 'Plan' was relabelled without noticing the
      // entry above already existed, so the menu showed the same word twice
      // pointing at two different screens.
      { label: 'Usage', hint: 'Scans used this month', icon: 'star', href: '/plan' },
    ],
  },
  {
    title: 'Household',
    entries: [
      { label: 'People', hint: 'Share with your family', icon: 'users', href: '/members' },
      { label: 'Categories', hint: 'How spending is sorted', icon: 'tag', href: '/categories' },
      { label: 'Settings', hint: 'Workspace and privacy', icon: 'cog', href: '/settings' },
    ],
  },
  {
    title: 'App',
    entries: [
      { label: 'Notifications', hint: 'What we are allowed to tell you', icon: 'bell', href: '/notifications' },
      { label: 'Privacy and data', hint: 'What is kept, and for how long', icon: 'shield', href: '/privacy' },
      { label: 'Export receipts', hint: 'Take everything with you', icon: 'upload', href: '/export' },
      { label: 'Help', hint: 'Answers, and how to reach us', icon: 'help', href: '/help' },
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
        <Section key={group.title} label={group.title}>
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
                minHeight: 56,
                paddingVertical: space.md,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: p.rule,
                backgroundColor: pressed && !e.soon ? p.surface : 'transparent',
                opacity: e.soon ? 0.55 : 1,
              })}
            >
              <Icon name={e.icon} size={20} color={p.inkStrong} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={[type.bodyStrong, { color: p.ink }]}>{e.label}</Text>
                <Small numberOfLines={1}>{e.hint}</Small>
              </View>
              {e.soon ? <Chip>Soon</Chip> : <Icon name="chevronRight" size={16} color={p.inkFaint} />}
            </Pressable>
          ))}
        </Section>
      ))}
    </View>
  );
}
