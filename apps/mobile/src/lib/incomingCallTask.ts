/**
 * Rings an Android phone whose app is in the background or closed.
 *
 * An incoming call arrives as a data push with no title, which expo-notifications
 * does not display — it hands it to this task, booting the app's JavaScript
 * headless if it has to. The task asks Android for a full-screen, looping call
 * notification (modules/velocity-calls). With the app on screen the
 * IncomingCallWatcher rings instead, so the task stands down.
 *
 * Defined from index.js, at the very top: a task has to exist before the
 * router loads, because a headless run never loads the router at all.
 */
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { callSystem } from '../../modules/velocity-calls';
import { callFromPush } from './callPush';

const INCOMING_CALL_TASK = 'velocity-incoming-call';

if (Platform.OS === 'android') {
  TaskManager.defineTask(INCOMING_CALL_TASK, async ({ data }) => {
    if (AppState.currentState === 'active') return;
    const call = callFromPush(data);
    if (call) callSystem.showIncoming(call.callId, call.title, call.text);
  });
  Notifications.registerTaskAsync(INCOMING_CALL_TASK).catch(() => {});
}
