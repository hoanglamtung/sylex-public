import React from 'react';
import {
  NavigationContainer,
  type NavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { UpgradeScreen } from '../screens/UpgradeScreen';
import { ConversationHistoryScreen } from '../screens/ConversationHistoryScreen';
import { RoutineListScreen } from '../screens/RoutineListScreen';
import { TextChatScreen } from '../screens/TextChatScreen';
import { RoutineDetailScreen } from '../screens/RoutineDetailScreen';
import { RoutineBuilderScreen } from '../screens/RoutineBuilderScreen';
import { RoutineExecutionScreen } from '../screens/RoutineExecutionScreen';
import { UserProfileScreen } from '../screens/UserProfileScreen';
import type { RoutineCategory } from '../types/routine';

export type RootStackParamList = {
  Home: undefined;
  TextChat: undefined;
  Settings: undefined;
  Upgrade: undefined;
  ConversationHistory: undefined;
  RoutineList: undefined;
  RoutineDetail: { routineId: string; category: RoutineCategory };
  RoutineBuilder: { routineId?: string };
  RoutineExecution: { routineId: string; category: RoutineCategory };
  UserProfile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

type AppNavigatorProps = {
  navigationRef?: React.Ref<NavigationContainerRef<RootStackParamList>>;
  onReady?: () => void;
};

export function AppNavigator({ navigationRef, onReady }: AppNavigatorProps = {}) {
  return (
    <NavigationContainer ref={navigationRef} onReady={onReady}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="TextChat" component={TextChatScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Upgrade" component={UpgradeScreen} />
        <Stack.Screen name="ConversationHistory" component={ConversationHistoryScreen} />
        <Stack.Screen name="RoutineList" component={RoutineListScreen} />
        <Stack.Screen name="RoutineDetail" component={RoutineDetailScreen} />
        <Stack.Screen name="RoutineBuilder" component={RoutineBuilderScreen} />
        <Stack.Screen name="RoutineExecution" component={RoutineExecutionScreen} />
        <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
