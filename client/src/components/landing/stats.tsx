const stats = [
  { value: "10K+", label: "Active Users" },
  { value: "500K+", label: "Posts Generated" },
  { value: "95%", label: "Time Saved" },
];

export function Stats() {
  return (
    <section className="py-16 border-y bg-card/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {stats.map((stat, index) => (
            <div key={index} className="text-center" data-testid={`stat-${index}`}>
              <div className="text-4xl md:text-5xl font-bold text-primary mb-2">
                {stat.value}
              </div>
              <div className="text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
