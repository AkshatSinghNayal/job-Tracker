// components/keywords.js — client-side tech skills and requirements extractor.
const KEYWORDS = [
  // Languages
  'Python', 'JavaScript', 'TypeScript', 'Go', 'Golang', 'Rust', 'Java', 'C++', 'C#', '.NET',
  'Ruby', 'PHP', 'Swift', 'Kotlin', 'Scala', 'SQL', 'Bash', 'Shell', 'R', 'Dart', 'Elixir',
  // Frameworks & Libraries
  'FastAPI', 'Django', 'Flask', 'React', 'Next.js', 'Vue', 'Nuxt', 'Node.js', 'Express',
  'Spring Boot', 'Spring', 'NestJS', 'Angular', 'Svelte', 'Tailwind', 'GraphQL', 'gRPC',
  'PyTorch', 'TensorFlow', 'Pandas', 'NumPy', 'Scikit-learn',
  // Cloud & DevOps
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'K8s', 'Terraform', 'CI/CD', 'GitHub Actions',
  'GitLab', 'Linux', 'Nginx', 'Serverless', 'Lambda', 'Helm', 'Ansible', 'Cloudflare',
  // Databases & Storage
  'MongoDB', 'PostgreSQL', 'Postgres', 'MySQL', 'Redis', 'Kafka', 'RabbitMQ', 'Elasticsearch',
  'ClickHouse', 'DynamoDB', 'Cassandra', 'SQLite', 'GridFS', 'NoSQL', 'Snowflake', 'BigQuery',
  // Architecture & Concepts
  'Microservices', 'System Design', 'REST API', 'RESTful', 'Distributed Systems', 'Concurrency',
  'AsyncIO', 'TDD', 'Agile', 'Scrum', 'Event-Driven', 'OAuth', 'JWT', 'WebSockets', 'ETL',
  'Observability', 'Prometheus', 'Grafana', 'Security', 'Scalability'
];

export function extractSkills(text = '') {
  if (!text) return [];
  const found = new Set();
  for (const kw of KEYWORDS) {
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9_#+])${escaped}(?:$|[^a-zA-Z0-9_#+])`, 'i');
    if (regex.test(text)) {
      found.add(kw);
    }
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}
