import { BarChart3, TrendingUp, Users, Eye, RefreshCw, Link2, Unlink, MessageSquare, Heart, Share2, MousePointer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiX } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { useEffect } from "react";
import { useSearch } from "wouter";

interface AnalyticsSummary {
  connected: {
    linkedin: boolean;
    twitter: boolean;
  };
  combined: {
    followers: number;
    following: number;
    posts: number;
    impressions: number;
    engagements: number;
    engagementRate: number;
    likes: number;
    comments: number;
    shares: number;
    clicks: number;
  };
  linkedin: {
    account: { name: string; handle: string; lastSync: string };
    metrics: Record<string, number>;
    topPosts: Array<{
      postId: string;
      content: string;
      impressions: number;
      engagements: number;
      likes: number;
      comments: number;
      shares: number;
      postedAt: string;
    }>;
  } | null;
  twitter: {
    account: { name: string; handle: string; lastSync: string };
    metrics: Record<string, number>;
    topPosts: Array<{
      postId: string;
      content: string;
      impressions: number;
      engagements: number;
      likes: number;
      comments: number;
      shares: number;
      postedAt: string;
    }>;
  } | null;
  lastSync: string | null;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function StatCard({ title, value, icon: Icon, description }: { title: string; value: string | number; icon: any; description?: string }) {
  return (
    <Card data-testid={`card-stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{typeof value === 'number' ? formatNumber(value) : value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

function TopPostCard({ post, platform }: { post: any; platform: 'linkedin' | 'twitter' }) {
  return (
    <Card className="overflow-visible" data-testid={`card-top-post-${post.postId}`}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${platform === 'linkedin' ? 'bg-brand-linkedin/10' : 'bg-foreground/10'}`}>
            {platform === 'linkedin' ? (
              <FaLinkedin className="w-4 h-4 text-brand-linkedin" />
            ) : (
              <SiX className="w-4 h-4" />
            )}
          </div>
          <p className="text-sm line-clamp-3">{post.content}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3" /> {formatNumber(post.impressions)}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="w-3 h-3" /> {formatNumber(post.likes)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> {post.comments}
          </span>
          <span className="flex items-center gap-1">
            <Share2 className="w-3 h-3" /> {post.shares}
          </span>
          <span className="ml-auto text-muted-foreground">
            {formatDistanceToNow(new Date(post.postedAt), { addSuffix: true })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionCard({ 
  provider, 
  connected, 
  accountInfo,
  onConnect, 
  onDisconnect,
  onSync,
  isConnecting,
  isDisconnecting,
  isSyncing,
  comingSoon = false
}: { 
  provider: 'linkedin' | 'twitter';
  connected: boolean;
  accountInfo?: { name: string; handle: string; lastSync: string } | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isSyncing: boolean;
  comingSoon?: boolean;
}) {
  const isLinkedIn = provider === 'linkedin';
  
  return (
    <Card className="overflow-visible" data-testid={`card-connection-${provider}`}>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-md flex items-center justify-center ${isLinkedIn ? 'bg-brand-linkedin/10' : 'bg-foreground/10'}`}>
              {isLinkedIn ? (
                <FaLinkedin className="w-5 h-5 text-brand-linkedin" />
              ) : (
                <SiX className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{isLinkedIn ? 'LinkedIn' : 'Twitter/X'}</span>
                {comingSoon ? (
                  <Badge variant="outline" className="text-xs">
                    Coming Soon
                  </Badge>
                ) : (
                  <Badge variant={connected ? "default" : "secondary"} className="text-xs">
                    {connected ? 'Connected' : 'Not connected'}
                  </Badge>
                )}
              </div>
              {connected && accountInfo && !comingSoon && (
                <p className="text-sm text-muted-foreground">
                  {accountInfo.name} ({accountInfo.handle})
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {comingSoon ? (
              <Button 
                variant="secondary"
                size="sm"
                disabled
                data-testid={`button-connect-${provider}`}
              >
                <Link2 className="w-4 h-4 mr-2" />
                Connect
              </Button>
            ) : connected ? (
              <>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={onSync}
                  disabled={isSyncing}
                  data-testid={`button-sync-${provider}`}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                  Sync
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={onDisconnect}
                  disabled={isDisconnecting}
                  data-testid={`button-disconnect-${provider}`}
                >
                  <Unlink className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              </>
            ) : (
              <Button 
                variant="default"
                size="sm"
                onClick={onConnect}
                disabled={isConnecting}
                data-testid={`button-connect-${provider}`}
              >
                <Link2 className="w-4 h-4 mr-2" />
                Connect
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <BarChart3 className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-2">No analytics data yet</h3>
      <p className="text-muted-foreground max-w-md mb-6">
        Connect your LinkedIn or Twitter account to start tracking your social media performance and see detailed analytics.
      </p>
    </div>
  );
}

function PlatformAnalytics({ data, platform }: { data: any; platform: 'linkedin' | 'twitter' }) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">
          Connect your {platform === 'linkedin' ? 'LinkedIn' : 'Twitter/X'} account to see analytics.
        </p>
      </div>
    );
  }

  const metrics = data.metrics;
  const topPosts = data.topPosts || [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Followers" value={metrics.followers} icon={Users} />
        <StatCard title="Impressions" value={metrics.impressions} icon={Eye} />
        <StatCard title="Engagements" value={metrics.engagements} icon={TrendingUp} />
        <StatCard title="Engagement Rate" value={`${metrics.engagementRate}%`} icon={BarChart3} />
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Likes" value={metrics.likes} icon={Heart} />
        <StatCard title="Comments" value={metrics.comments} icon={MessageSquare} />
        <StatCard title="Shares" value={metrics.shares} icon={Share2} />
        <StatCard title="Clicks" value={metrics.clicks} icon={MousePointer} />
      </div>

      {topPosts.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-4">Top Performing Posts</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {topPosts.map((post: any) => (
              <TopPostCard key={post.postId} post={post} platform={platform} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const { toast } = useToast();
  const searchString = useSearch();

  const { data: summary, isLoading, refetch } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
  });

  // Handle OAuth callback URL parameters
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const connected = params.get('connected');
    const error = params.get('error');
    
    if (connected) {
      refetch();
      toast({
        title: "Account Connected",
        description: `Your ${connected} account has been connected successfully.`,
      });
      window.history.replaceState({}, '', '/analytics');
    }
    
    if (error) {
      toast({
        title: "Connection Failed",
        description: "Failed to connect account. Please try again.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', '/analytics');
    }
  }, [searchString, toast, refetch]);

  // Connect LinkedIn via OAuth redirect
  const handleLinkedInConnect = () => {
    window.location.href = '/auth/linkedin/analytics';
  };

  // Connect Twitter via API (demo data since Twitter API requires elevated access)
  const connectTwitterMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/social/connect/twitter');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/summary'] });
      toast({
        title: "Account Connected",
        description: "Your Twitter/X account has been connected successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect account. Please try again.",
        variant: "destructive",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (provider: string) => {
      return apiRequest('DELETE', `/api/social/disconnect/${provider}`);
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/summary'] });
      toast({
        title: "Account Disconnected",
        description: `Your ${provider} account has been disconnected.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Disconnection Failed",
        description: error.message || "Failed to disconnect account.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (provider: string) => {
      return apiRequest('POST', `/api/social/sync/${provider}`);
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/summary'] });
      toast({
        title: "Sync Complete",
        description: `Your ${provider} analytics have been updated.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync analytics.",
        variant: "destructive",
      });
    },
  });

  const hasAnyConnection = summary?.connected.linkedin || summary?.connected.twitter;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-page-title">Analytics</h1>
              <p className="text-sm text-muted-foreground">
                Track your content performance across platforms
              </p>
            </div>
          </div>
          {summary?.lastSync && (
            <p className="text-xs text-muted-foreground">
              Last synced {formatDistanceToNow(new Date(summary.lastSync), { addSuffix: true })}
            </p>
          )}
        </div>
      </header>
      
      <main className="flex-1 p-6 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <h2 className="text-lg font-medium mb-4">Connected Accounts</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <ConnectionCard
                  provider="linkedin"
                  connected={summary?.connected.linkedin || false}
                  accountInfo={summary?.linkedin?.account}
                  onConnect={handleLinkedInConnect}
                  onDisconnect={() => disconnectMutation.mutate('linkedin')}
                  onSync={() => syncMutation.mutate('linkedin')}
                  isConnecting={false}
                  isDisconnecting={disconnectMutation.isPending && disconnectMutation.variables === 'linkedin'}
                  isSyncing={syncMutation.isPending && syncMutation.variables === 'linkedin'}
                />
                <ConnectionCard
                  provider="twitter"
                  connected={summary?.connected.twitter || false}
                  accountInfo={summary?.twitter?.account}
                  onConnect={() => connectTwitterMutation.mutate()}
                  onDisconnect={() => disconnectMutation.mutate('twitter')}
                  onSync={() => syncMutation.mutate('twitter')}
                  isConnecting={connectTwitterMutation.isPending}
                  isDisconnecting={disconnectMutation.isPending && disconnectMutation.variables === 'twitter'}
                  isSyncing={syncMutation.isPending && syncMutation.variables === 'twitter'}
                  comingSoon={true}
                />
              </div>
            </section>

            {!hasAnyConnection ? (
              <EmptyState />
            ) : (
              <Tabs defaultValue="combined" className="w-full">
                <TabsList data-testid="tabs-analytics-view">
                  <TabsTrigger value="combined" data-testid="tab-combined">Combined</TabsTrigger>
                  <TabsTrigger value="linkedin" disabled={!summary?.connected.linkedin} data-testid="tab-linkedin">
                    LinkedIn
                  </TabsTrigger>
                  <TabsTrigger value="twitter" disabled={!summary?.connected.twitter} data-testid="tab-twitter">
                    Twitter/X
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="combined" className="mt-6">
                  {summary && (
                    <div className="space-y-6">
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <StatCard title="Total Followers" value={summary.combined.followers} icon={Users} />
                        <StatCard title="Total Impressions" value={summary.combined.impressions} icon={Eye} />
                        <StatCard title="Total Engagements" value={summary.combined.engagements} icon={TrendingUp} />
                        <StatCard title="Avg Engagement Rate" value={`${summary.combined.engagementRate}%`} icon={BarChart3} />
                      </div>
                      
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <StatCard title="Total Likes" value={summary.combined.likes} icon={Heart} />
                        <StatCard title="Total Comments" value={summary.combined.comments} icon={MessageSquare} />
                        <StatCard title="Total Shares" value={summary.combined.shares} icon={Share2} />
                        <StatCard title="Total Clicks" value={summary.combined.clicks} icon={MousePointer} />
                      </div>

                      <div>
                        <h3 className="text-lg font-medium mb-4">Top Performing Posts</h3>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {summary.linkedin?.topPosts?.map((post: any) => (
                            <TopPostCard key={post.postId} post={post} platform="linkedin" />
                          ))}
                          {summary.twitter?.topPosts?.map((post: any) => (
                            <TopPostCard key={post.postId} post={post} platform="twitter" />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="linkedin" className="mt-6">
                  <PlatformAnalytics data={summary?.linkedin} platform="linkedin" />
                </TabsContent>
                
                <TabsContent value="twitter" className="mt-6">
                  <PlatformAnalytics data={summary?.twitter} platform="twitter" />
                </TabsContent>
              </Tabs>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
