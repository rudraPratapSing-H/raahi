export async function fetchTopologicalGraph() {
  try {
    // Note: If using Android Emulator, use 'http://10.0.2.2:8000/api/graph' instead of 'localhost'
    // If using iOS Simulator or physical device on same WiFi, use your computer's local IP (e.g., 'http://192.168.1.X:8000/api/graph')
    const response = await fetch('http://localhost:8000/api/graph');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch topological graph from local backend:", error);
    // Fallback or rethrow depending on your app's needs
    return { nodes: [], edges: [] };
  }
}
