/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';
import { handleRoutineNotificationDelivery } from '../src/services/routineScheduleService';

notifee.onBackgroundEvent(async ({ type, detail }) => {
	if (type === EventType.DELIVERED) {
		await handleRoutineNotificationDelivery(detail.notification);
	}
});

AppRegistry.registerComponent(appName, () => App);
