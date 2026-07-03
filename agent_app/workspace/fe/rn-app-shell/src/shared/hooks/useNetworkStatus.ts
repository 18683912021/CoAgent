import { useState, useEffect } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

/**
 * 监听网络状态
 */
export function useNetworkStatus(): {
  isConnected: boolean;
  networkType: string;
} {
  const [isConnected, setIsConnected] = useState(true);
  const [networkType, setNetworkType] = useState('unknown');

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsConnected(state.isConnected ?? true);
      setNetworkType(state.type);
    });

    return () => unsubscribe();
  }, []);

  return { isConnected, networkType };
}
