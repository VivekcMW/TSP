import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Rss, Globe, Trash2, CheckCircle2, XCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { UserSource } from "@shared/schema";

/**
 * Shared "add your own sources" panel — the only thing (besides live
 * keyword search) Discover ever fetches from. Used both inline in Profile
 * Settings and in a Sheet directly on the Discover page, so there's one
 * place a user can add as many URLs as they want, no pre-configured list.
 */
export function SourcesManagerContent() {
  const { toast } = useToast();
  const { data: sources = [], isLoading: sourcesLoading } = useQuery<UserSource[]>({ queryKey: ["/api/sources"] });
  const { data: sourceSuggestions = [] } = useQuery<Array<{ id: string; name: string; feedUrl: string }>>({ queryKey: ["/api/sources/suggestions"] });
  const [newSourceInput, setNewSourceInput] = useState("");

  const addSourceMutation = useMutation({
    mutationFn: async (input: string) => (await apiRequest("POST", "/api/sources", { input })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      setNewSourceInput("");
      toast({ title: "Source added", description: "We'll include it the next time you refresh Discover." });
    },
    onError: (error: Error) => toast({ title: "Couldn't add that source", description: error.message, variant: "destructive" }),
  });
  const addSuggestedSourceMutation = useMutation({
    mutationFn: async (suggestion: { name: string; feedUrl: string }) => (await apiRequest("POST", "/api/sources", suggestion)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/sources"] }); toast({ title: "Source added" }); },
    onError: (error: Error) => toast({ title: "Couldn't add that source", description: error.message, variant: "destructive" }),
  });
  const toggleSourceMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/sources/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sources"] }),
  });
  const deleteSourceMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/sources/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/sources"] }); toast({ title: "Source removed" }); },
  });

  return (
    <div className="space-y-4">
      {sourcesLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources added yet. Add a website or feed URL below.</p>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="flex items-center gap-3 rounded-[4px] border p-3" data-testid={`source-${source.id}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-secondary/15">
                {source.sourceType === "webpage" ? <Globe className="h-4 w-4 text-secondary" /> : <Rss className="h-4 w-4 text-secondary" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{source.name}</p>
                <p className="truncate text-xs text-muted-foreground">{source.feedUrl}</p>
                {source.lastFetchStatus === "error" && (
                  <p className="break-words text-xs text-destructive">{source.lastFetchError || "This source could not be read. Try again later or check its URL."}</p>
                )}
              </div>
              {source.lastFetchStatus === "ok" && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Last fetch succeeded" />}
              {source.lastFetchStatus === "error" && <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Last fetch failed" />}
              <Switch
                checked={source.isActive}
                onCheckedChange={(checked) => toggleSourceMutation.mutate({ id: source.id, isActive: checked })}
                aria-label={`${source.isActive ? "Disable" : "Enable"} ${source.name}`}
              />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={deleteSourceMutation.isPending} onClick={() => deleteSourceMutation.mutate(source.id)} aria-label={`Remove ${source.name}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={newSourceInput}
          onChange={(event) => setNewSourceInput(event.target.value)}
          placeholder="https://publication.com/blog"
          aria-label="Add a source"
          maxLength={300}
          disabled={addSourceMutation.isPending || addSuggestedSourceMutation.isPending}
          onKeyDown={(event) => { if (event.key === "Enter" && newSourceInput.trim() && !addSourceMutation.isPending && !addSuggestedSourceMutation.isPending) addSourceMutation.mutate(newSourceInput.trim()); }}
        />
        <Button type="button" onClick={() => addSourceMutation.mutate(newSourceInput.trim())} disabled={!newSourceInput.trim() || addSourceMutation.isPending || addSuggestedSourceMutation.isPending}>
          <Plus className="mr-2 h-4 w-4" />{addSourceMutation.isPending ? "Adding..." : "Add"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste the publication's actual URL; names alone are not matched to guessed domains.
        Public feeds and readable webpages are supported. Login, paywall, bot-protected, and JavaScript-only pages may not be accessible.
        Refreshes process up to 30 sources at a time, oldest fetched first.
      </p>
      {sourceSuggestions.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground">Suggested for your industry</p>
          <div className="flex flex-wrap gap-2">
            {sourceSuggestions
              .filter((suggestion) => !sources.some((s) => s.feedUrl === suggestion.feedUrl))
              .map((suggestion) => (
                <Button
                  key={suggestion.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={addSuggestedSourceMutation.isPending || addSourceMutation.isPending}
                  title={suggestion.feedUrl}
                  onClick={() => addSuggestedSourceMutation.mutate(suggestion)}
                >
                  <Plus className="mr-1.5 h-3 w-3" />{suggestion.name}
                </Button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
