import React from 'react';
import ActivityScreen from './ActivityScreen';
import AdsAgent from './AdsAgent';
import Billing from './Billing';
import ConnectedAccounts from './ConnectedAccounts';
import ContentAgent from './ContentAgent';
import GoalPlan from './GoalPlan';
import MakeMeLearn from './MakeMeLearn';
import NotificationsScreen from './NotificationsScreen';
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
  /** What the home box was asked for, when the destination is the plan. */
  goal?: string;
};

/**
 * One place that says which screen a title means. Everything the drawer, the
 * tabs, the home tiles and the bell point at is listed here; anything else
 * falls back to the stand-in pane.
 */
export function screenFor(title: string, ctx: Ctx): React.ReactNode {
  switch (title) {
    case 'Research Agent':
      return <ResearchAgent />;
    case 'Content Agent':
    case 'Content':
      return <ContentAgent />;
    case 'Ads Agent':
      return <AdsAgent />;
    case 'Sales Agent':
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
    case 'Your plan':
      return <GoalPlan goal={ctx.goal} />;
    default:
      return <Pane title={title} line="This screen is next — the drawer already takes you here." />;
  }
}
