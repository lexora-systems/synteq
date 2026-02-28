type CounterMap = Record<string, number>;

type GaugeMap = Record<string, number>;

class RuntimeMetrics {
  private counters: CounterMap = {};
  private gauges: GaugeMap = {};

  increment(counter: string, value = 1) {
    this.counters[counter] = (this.counters[counter] ?? 0) + value;
  }

  setGauge(gauge: string, value: number) {
    this.gauges[gauge] = value;
  }

  snapshot() {
    return {
      counters: { ...this.counters },
      gauges: { ...this.gauges },
      timestamp: new Date().toISOString()
    };
  }

  toPrometheusText() {
    const lines: string[] = [];

    for (const [name, value] of Object.entries(this.counters)) {
      lines.push(`# TYPE synteq_${name} counter`);
      lines.push(`synteq_${name} ${value}`);
    }

    for (const [name, value] of Object.entries(this.gauges)) {
      lines.push(`# TYPE synteq_${name} gauge`);
      lines.push(`synteq_${name} ${value}`);
    }

    return `${lines.join("\n")}\n`;
  }
}

export const runtimeMetrics = new RuntimeMetrics();
