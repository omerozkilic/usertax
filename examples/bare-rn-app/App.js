import { useState } from 'react';
import { Button, Text, View } from 'react-native';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>usertax example</Text>
      <Button title={`Clicked ${count} times`} onPress={() => setCount((value) => value + 1)} />
    </View>
  );
}
