// RunFinder Crawler — busca corridas via IA e salva no Supabase
// Roda via GitHub Actions todo dia às 6h (horário de Brasília)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error('❌ Variáveis de ambiente faltando');
  process.exit(1);
}

// Cidades/regiões para buscar a cada execução
// Rotaciona para cobrir todo o Brasil ao longo da semana
const REGIONS = [
  // Dia 1 - RJ
  { city: 'Niterói', state: 'RJ', lat: -22.8833, lng: -43.1036 },
  { city: 'Rio de Janeiro', state: 'RJ', lat: -22.9068, lng: -43.1729 },
  // Dia 2 - SP
  { city: 'São Paulo', state: 'SP', lat: -23.5505, lng: -46.6333 },
  { city: 'Campinas', state: 'SP', lat: -22.9056, lng: -47.0608 },
  // Dia 3 - Sul
  { city: 'Curitiba', state: 'PR', lat: -25.4284, lng: -49.2733 },
  { city: 'Florianópolis', state: 'SC', lat: -27.5954, lng: -48.5480 },
  { city: 'Porto Alegre', state: 'RS', lat: -30.0346, lng: -51.2177 },
  // Dia 4 - MG/ES
  { city: 'Belo Horizonte', state: 'MG', lat: -19.9167, lng: -43.9345 },
  { city: 'Vitória', state: 'ES', lat: -20.3222, lng: -40.3381 },
  // Dia 5 - Centro-Oeste
  { city: 'Brasília', state: 'DF', lat: -15.7801, lng: -47.9292 },
  { city: 'Goiânia', state: 'GO', lat: -16.6869, lng: -49.2648 },
  // Dia 6 - Nordeste
  { city: 'Salvador', state: 'BA', lat: -12.9714, lng: -38.5014 },
  { city: 'Fortaleza', state: 'CE', lat: -3.7172, lng: -38.5433 },
  { city: 'Recife', state: 'PE', lat: -8.0476, lng: -34.8770 },
  // Dia 7 - Norte
  { city: 'Manaus', state: 'AM', lat: -3.1019, lng: -60.0250 },
  { city: 'Belém', state: 'PA', lat: -1.4558, lng: -48.5044 },
];

// Selecionar regiões do dia baseado no dia da semana
function getTodayRegions() {
  const day = new Date().getDay(); // 0=Dom, 6=Sáb
  const perDay = Math.ceil(REGIONS.length / 7);
  const start = day * perDay;
  return REGIONS.slice(start, start + perDay);
}

// Buscar corridas via Anthropic API
async function searchRaces(region) {
  const today = new Date();
  const end = new Date();
  end.setMonth(end.getMonth() + 6);
  const fmt = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  const prompt = `Você é especialista em corridas de rua no Brasil. 
Busque corridas de rua REAIS que acontecerão em ${region.city}, ${region.state} e cidades num raio de 100km, 
entre ${fmt(today)} e ${fmt(end)}.

Retorne SOMENTE JSON válido sem markdown:
{
  "races": [
    {
      "name": "Nome oficial da corrida",
      "date": "YYYY-MM-DD",
      "city": "Cidade",
      "state": "UF",
      "lat": latitude,
      "lng": longitude,
      "distances": ["5K","10K"],
      "price": "R$ 60–R$ 120",
      "link": "URL ou null",
      "organizer": "Organizador ou null",
      "description": "1 frase descrevendo a corrida"
    }
  ]
}
Retorne apenas corridas com datas confirmadas. Entre 3 e 15 corridas.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  
  // Extrair texto da resposta (pode ter tool_use antes)
  let text = '';
  for (const block of data.content || []) {
    if (block.type === 'text') text += block.text;
  }

  // Se só retornou tool_use, fazer segunda chamada
  if (!text && data.content?.some(b => b.type === 'tool_use')) {
    const toolUse = data.content.find(b => b.type === 'tool_use');
    const res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: data.content },
          { role: 'user', content: [{ 
            type: 'tool_result', 
            tool_use_id: toolUse.id, 
            content: 'Use os resultados da busca para retornar o JSON.'
          }]}
        ],
      }),
    });
    const data2 = await res2.json();
    for (const block of data2.content || []) {
      if (block.type === 'text') text += block.text;
    }
  }

  if (!text) return [];

  try {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(s, e + 1));
    return parsed.races || [];
  } catch {
    console.warn(`⚠️ Falha ao parsear resposta para ${region.city}`);
    return [];
  }
}

// Verificar se corrida já existe no banco (deduplicação)
async function raceExists(name, date) {
  const encodedName = encodeURIComponent(name);
  const url = `${SUPABASE_URL}/rest/v1/races?name=ilike.${encodedName}&date=eq.${date}&select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

// Inserir corrida no banco
async function insertRace(race) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/races`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      name: race.name,
      date: race.date,
      city: race.city,
      state: race.state,
      lat: race.lat || null,
      lng: race.lng || null,
      distances: race.distances || [],
      price: race.price || null,
      link: race.link || null,
      organizer: race.organizer || null,
      description: race.description || null,
      is_featured: false,
      is_manual: false,
      is_active: true,
      source: 'crawler',
    }),
  });
  return res.ok || res.status === 201;
}

// Main
async function main() {
  const regions = getTodayRegions();
  console.log(`\n🏃 RunFinder Crawler iniciado — ${new Date().toLocaleString('pt-BR')}`);
  console.log(`📍 Regiões de hoje: ${regions.map(r => r.city).join(', ')}\n`);

  let totalFound = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const region of regions) {
    console.log(`\n🔍 Buscando corridas em ${region.city}, ${region.state}...`);
    
    try {
      const races = await searchRaces(region);
      console.log(`  Encontradas: ${races.length} corridas`);

      for (const race of races) {
        // Validar campos obrigatórios
        if (!race.name || !race.date || !race.city) {
          console.warn(`  ⚠️ Corrida inválida ignorada: ${JSON.stringify(race).substring(0, 50)}`);
          continue;
        }

        // Validar data
        const raceDate = new Date(race.date);
        const today = new Date();
        if (isNaN(raceDate.getTime()) || raceDate < today) {
          console.warn(`  ⚠️ Data inválida ou passada: ${race.name} (${race.date})`);
          continue;
        }

        totalFound++;

        // Verificar duplicata
        const exists = await raceExists(race.name, race.date);
        if (exists) {
          console.log(`  ↩️  Já existe: ${race.name}`);
          totalSkipped++;
          continue;
        }

        // Inserir
        const ok = await insertRace(race);
        if (ok) {
          console.log(`  ✅ Inserida: ${race.name} (${race.date})`);
          totalInserted++;
        } else {
          console.warn(`  ❌ Falha ao inserir: ${race.name}`);
        }

        // Rate limit: aguardar 200ms entre inserções
        await new Promise(r => setTimeout(r, 200));
      }

    } catch (err) {
      console.error(`  ❌ Erro ao buscar ${region.city}: ${err.message}`);
    }

    // Aguardar 2s entre regiões para não sobrecarregar API
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Crawler concluído!`);
  console.log(`   Corridas encontradas: ${totalFound}`);
  console.log(`   Inseridas: ${totalInserted}`);
  console.log(`   Já existiam: ${totalSkipped}`);
  console.log(`${'='.repeat(50)}\n`);
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
