import { BarChart3, TrendingUp, Users, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SiLinkedin, SiX } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";

const stats = [
  { title: "Total Posts", value: "24", change: "+12%", icon: BarChart3 },
  { title: "Total Reach", value: "12.4K", change: "+23%", icon: Eye },
  { title: "Engagement Rate", value: "4.2%", change: "+8%", icon: TrendingUp },
  { title: "New Followers", value: "156", change: "+18%", icon: Users },
];

export default function AnalyticsPage() {
  const { toast } = useToast();

  const handleLinkedInConnect = () => {
    toast({
      title: "LinkedIn Connect",
      description: "LinkedIn analytics integration coming soon. Connect your account to track post performance.",
    });
  };

  const handleTwitterConnect = () => {
    toast({
      title: "Twitter/X Connect",
      description: "Twitter/X analytics integration coming soon. Connect your account to track post performance.",
    });
  };

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
                Track your content performance
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button 
              variant="outline" 
              onClick={handleLinkedInConnect}
              data-testid="button-linkedin-connect"
            >
              <SiLinkedin className="w-4 h-4 mr-2 text-[#0A66C2]" />
              LinkedIn Connect
            </Button>
            <Button 
              variant="outline" 
              onClick={handleTwitterConnect}
              data-testid="button-twitter-connect"
            >
              <SiX className="w-4 h-4 mr-2" />
              Twitter Connect
            </Button>
          </div>
        </div>
      </header>
      
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {stats.map((stat, index) => (
            <Card key={index} data-testid={`card-stat-${index}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="text-status-online">{stat.change}</span> from last month
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Performance Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              <p>Chart visualization would appear here</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
