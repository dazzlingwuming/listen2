import React from 'react';
import { StatusBar } from 'react-native';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { RootNavigator } from './src/navigation/RootNavigator';
import { persistor, store } from './src/store';

function App() {
  return <Provider store={store}>
    <PersistGate loading={null} persistor={persistor}>
      <StatusBar barStyle="light-content" />
      <RootNavigator />
    </PersistGate>
  </Provider>;
}

export default App;
