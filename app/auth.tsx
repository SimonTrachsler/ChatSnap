import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { LoadingScreen } from '@/components/LoadingScreen';

export default function LegacyAuthRoute() {
  const params = useLocalSearchParams<{ mode?: string }>();

  useEffect(() => {
    if (params.mode === 'login') {
      router.replace('/login');
      return;
    }
    if (params.mode === 'register') {
      router.replace('/register');
      return;
    }
    router.replace('/welcome');
  }, [params.mode]);

  return <LoadingScreen message="Redirecting..." />;
}

