import { useAuth } from '@/contexts/AuthContext'

export function useSubscription() {
  const { canAccessBidClaw, subscriptionTier, user } = useAuth()
  return {
    canAccess: canAccessBidClaw,
    tier: subscriptionTier,
    isBidClaw: subscriptionTier === 'bidclaw',
    isPro: subscriptionTier === 'pro',
    isFree: subscriptionTier === 'free',
    userEmail: user?.email ?? null,
  }
}
