import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useNavigationThread } from '../hooks/useNavigationThread';
import { MOCK_FRAME_NODE_1, MOCK_FRAME_NODE_2, MOCK_FRAME_OFF_PATH } from '../data/mockFrames';

const API_KEY = "AIzaSyBy_QgNUMkRP_Wd6ViSVtahiBI6Z04tgis"; 

export default function DevSimulatorHarness() {
  const { currentNodeId, processFrameForNavigation } = useNavigationThread(API_KEY);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Virtual Walkthrough Simulator</Text>
      
      <View style={styles.stateContainer}>
        <Text style={styles.stateLabel}>Current Node ID:</Text>
        <Text style={styles.stateValue}>{currentNodeId || 'Unknown (Searching...)'}</Text>
      </View>

      <View style={styles.buttonContainer}>
        <Button 
          title="Send Frame: Node 1" 
          onPress={() => processFrameForNavigation(MOCK_FRAME_NODE_1)} 
        />
        <View style={styles.spacer} />
        <Button 
          title="Send Frame: Node 2" 
          onPress={() => processFrameForNavigation(MOCK_FRAME_NODE_2)} 
        />
        <View style={styles.spacer} />
        <Button 
          title="Send Frame: Off Path (No Match)" 
          onPress={() => processFrameForNavigation(MOCK_FRAME_OFF_PATH)} 
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 30, textAlign: 'center' },
  stateContainer: { marginBottom: 40, alignItems: 'center' },
  stateLabel: { fontSize: 18, color: '#555' },
  stateValue: { fontSize: 22, fontWeight: '600', color: '#007AFF', marginTop: 10 },
  buttonContainer: { paddingHorizontal: 20 },
  spacer: { height: 15 }
});
