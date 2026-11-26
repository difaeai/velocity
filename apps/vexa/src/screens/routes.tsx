import React from 'react';
import ActivityScreen from './ActivityScreen';
import AdsAgent from './AdsAgent';
import Billing from './Billing';
import ConnectedAccounts from './ConnectedAccounts';
import ContentAgent from './ContentAgent';
import AskVexa from './AskVexa';
import MakeMeLearn from './MakeMeLearn';
import NotificationsScreen from './NotificationsScreen';
import Outreach from './Outreach';
import Pane from './Pane';
import ProfileScreen from './ProfileScreen';
import ProPlans from './ProPlans';
import ResearchAgent from './ResearchAgent';
import SalesAgent from './SalesAgent';
import UsageScreen from './Usage';

export type Ctx = {
  /** Push another destination from inside a screen. */
  onOpen: (title: string) => void;
  onLogout: () => void;
  /** Hand her a new sentence and open Ask Vexa on it. */
  onAsk: (text: string) => void;
  /** What the home box was asked for, when the destination is Ask Vexa. */
  goal?: string;
};

/**
 * One place that says which screen a title means. Everything the drawer, the
 * tabs, the home tiles and the bell point at is listed here; anything else
 * falls back to the stand-in pane.
 */
export function screenFor(title: string, ctx: Ctx): React.ReactNode {
  switch (title) {
    case 'Research Team':
      return <ResearchAgent />;
    case 'Content Team':
    case 'Content':
      return <ContentAgent />;
    case 'Ads Expert':
      return <AdsAgent />;
    case 'Sales Team':
      return <SalesAgent />;
    case 'Connected Accounts':
      return <ConnectedAccounts />;
    case 'Make me Learn':
      return <MakeMeLearn />;
    case 'Usage':
      return <UsageScreen />;
    case 'Billing':
      return <Billing onOpen={ctx.onOpen} />;
    case 'Vexa Pro':
    case 'Upgrade to Pro':
    case 'Subscription':
      return <ProPlans />;
    case 'Activity':
      return <ActivityScreen />;
    case 'Profile':
    case 'Your business':
      return <ProfileScreen onOpen={ctx.onOpen} onLogout={ctx.onLogout} />;
    case 'Notifications':
      return <NotificationsScreen onOpen={ctx.onOpen} />;
    case 'Ask Vexa':
    case 'Your plan':
      return <AskVexa goal={ctx.goal} onOpen={ctx.onOpen} />;
    case 'Outreach':
      return <Outreach onAsk={ctx.onAsk} onOpen={ctx.onOpen} />;
    default:
      return <Pane title={title} line="This screen is next — the drawer already takes you here." />;
  }
}
