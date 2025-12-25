import { Settings, User, Bell, Link2, CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const initials = user?.firstName && user?.lastName 
    ? `${user.firstName[0]}${user.lastName[0]}` 
    : user?.email?.[0]?.toUpperCase() || "U";

  const handleSave = () => {
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated.",
    });
  };

  return (
    <div className="flex-1 overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account and preferences
            </p>
          </div>
        </div>
      </header>
      
      <main className="p-6 overflow-y-auto h-[calc(100vh-80px)]">
        <div className="max-w-3xl">
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="profile" data-testid="tab-profile">
                <User className="w-4 h-4 mr-2" />
                Profile
              </TabsTrigger>
              <TabsTrigger value="notifications" data-testid="tab-notifications">
                <Bell className="w-4 h-4 mr-2" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="integrations" data-testid="tab-integrations">
                <Link2 className="w-4 h-4 mr-2" />
                Integrations
              </TabsTrigger>
              <TabsTrigger value="billing" data-testid="tab-billing">
                <CreditCard className="w-4 h-4 mr-2" />
                Billing
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="profile">
              <Card>
                <CardHeader>
                  <CardTitle>Profile Information</CardTitle>
                  <CardDescription>Update your account details and public profile.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage src={user?.profileImageUrl || undefined} alt={user?.firstName || "User"} />
                      <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
                    </Avatar>
                    <div>
                      <Button variant="outline" size="sm" data-testid="button-change-photo">
                        Change Photo
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPG, PNG or GIF. Max 2MB.
                      </p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input 
                        id="firstName" 
                        defaultValue={user?.firstName || ""} 
                        data-testid="input-first-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input 
                        id="lastName" 
                        defaultValue={user?.lastName || ""} 
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      defaultValue={user?.email || ""} 
                      disabled
                      data-testid="input-email"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email is managed by your authentication provider.
                    </p>
                  </div>
                  
                  <Button onClick={handleSave} data-testid="button-save-profile">
                    Save Changes
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="notifications">
              <Card>
                <CardHeader>
                  <CardTitle>Notification Preferences</CardTitle>
                  <CardDescription>Choose what updates you want to receive.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Daily Digest</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive a daily email with your curated content
                      </p>
                    </div>
                    <Switch defaultChecked data-testid="switch-daily-digest" />
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>New Content Alerts</Label>
                      <p className="text-sm text-muted-foreground">
                        Get notified when high-priority content arrives
                      </p>
                    </div>
                    <Switch data-testid="switch-content-alerts" />
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Product Updates</Label>
                      <p className="text-sm text-muted-foreground">
                        Learn about new features and improvements
                      </p>
                    </div>
                    <Switch defaultChecked data-testid="switch-product-updates" />
                  </div>
                  
                  <Button onClick={handleSave} data-testid="button-save-notifications">
                    Save Preferences
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="integrations">
              <Card>
                <CardHeader>
                  <CardTitle>Connected Accounts</CardTitle>
                  <CardDescription>Manage your social media connections.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-[#0077b5] flex items-center justify-center text-white">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium">LinkedIn</p>
                        <p className="text-sm text-muted-foreground">Connected</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" data-testid="button-disconnect-linkedin">
                      Disconnect
                    </Button>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 border rounded-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-black flex items-center justify-center text-white">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium">Twitter/X</p>
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      </div>
                    </div>
                    <Button size="sm" data-testid="button-connect-twitter">
                      Connect
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="billing">
              <Card>
                <CardHeader>
                  <CardTitle>Billing & Subscription</CardTitle>
                  <CardDescription>Manage your subscription and payment methods.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 border rounded-md bg-primary/5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">Free Plan</span>
                      <span className="text-sm text-muted-foreground">Current Plan</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      5 inbox items per day, 3 post generations
                    </p>
                    <Button data-testid="button-upgrade">
                      Upgrade to Pro
                    </Button>
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <h4 className="font-medium mb-2">Payment Method</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      No payment method on file.
                    </p>
                    <Button variant="outline" data-testid="button-add-payment">
                      Add Payment Method
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
