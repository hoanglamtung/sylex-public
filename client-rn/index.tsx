import '../src/i18n'; // initialise i18n before rendering
import { initFirestore } from './src/services/syncService'; // enable offline persistence (#132)
import React from 'react';
import { AppNavigator } from './src/navigation/AppNavigator';

initFirestore();

export default function App() {
  return <AppNavigator />;
}
