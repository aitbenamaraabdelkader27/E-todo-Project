# E-Todo Flow

**Plan your day, naturally.**

Une application de productivité full-stack centrée sur le temps : capturez une idée dans l’Inbox, donnez-lui une place dans votre journée et laissez un moteur déterministe organiser le reste. La timeline représente les durées et les chevauchements réels ; chaque modification est persistée dans PostgreSQL.

L’interface est en anglais, la documentation technique en français. Le projet fonctionne localement et ne dépend d’aucun service d’IA, compte tiers ou API payante.

![La timeline quotidienne d’E-Todo Flow, avec Inbox et activités simultanées](artifacts/desktop-1440x900.png)

## Ce que l’application propose

- Inscription, connexion et déconnexion avec sessions serveur et mots de passe hashés.
- Démo privée sans inscription : trois projets, tâches planifiées, Inbox, événements fixes, activités passives et chevauchements d’exemple.
- Création rapide, description, durée, priorité, échéance, projet, réalisation, archivage et suppression des tâches.
- Timeline quotidienne : navigation par date, déplacement, redimensionnement, prévisualisation, chevauchements en colonnes et plages libres.
- Placement accessible depuis le formulaire ; déplacement et redimensionnement au clavier, par pas de 15 minutes.
- **Organize my day** : planification backend transactionnelle autour des engagements existants, avec explications pour les tâches restantes.
- Projets, recherche, tâches terminées, archive, fuseau horaire et disponibilité quotidienne configurables.
- Adaptation mobile, dialogues accessibles, notifications et animations respectant la réduction des mouvements.

Les comptes réels commencent vides. La démo crée un espace distinct, associé à sa propre session, qui expire après 24 heures. Elle ne donne aucun accès aux comptes réels.

## Démarrage local

Prérequis : **Node.js 22.13 ou supérieur** dans la branche 22 LTS, npm, Docker avec Compose. Sans Docker, utilisez une installation PostgreSQL 16 ou supérieure et créez deux bases séparées.

```bash
cp .env.example .env
npm ci
docker compose up -d db
npm run db:migrate
npm run dev
```

Ouvrez **http://localhost:5173**, puis **Explore the live demo** ou créez un compte. Vite transmet `/api` à Express sur le port 3001. Les migrations créent le schéma ; aucune commande de démarrage ne réinitialise les données.

Si le port 5173 est occupé, Vite peut choisir le suivant. Libérez le port ou adaptez `APP_ORIGIN` dans `.env` à l’adresse exacte affichée, puis redémarrez l’API. Cette origine est contrôlée pour protéger les écritures.

Si PostgreSQL utilise déjà le port 5432, définissez `POSTGRES_PORT=55433` dans `.env` et remplacez aussi le port dans `DATABASE_URL` et `TEST_DATABASE_URL`. Les autres services restent intacts.

Pour arrêter les processus locaux : `Ctrl+C`. Pour arrêter PostgreSQL sans effacer son volume :

```bash
docker compose stop db
```

### Variables d’environnement

| Variable | Utilisation |
| --- | --- |
| `DATABASE_URL` | Connexion PostgreSQL de l’application. |
| `TEST_DATABASE_URL` | Base distincte pour les tests d’intégration ; son nom doit se terminer par `_test`. |
| `APP_ORIGIN` | Origine autorisée, sans chemin ni barre finale, par exemple `http://localhost:5173`. Plusieurs origines explicites peuvent être séparées par des virgules. |
| `PORT` | Port Express, 3001 par défaut. |
| `POSTGRES_PORT` | Port PostgreSQL publié localement par Compose, 5432 par défaut ; adaptez aussi les URL de connexion si vous le changez. |
| `NODE_ENV` | `development` en développement ; `production` pour servir le build. |
| `COOKIE_SECURE` | Cookies sécurisés par défaut en production. `false` est réservé à une exécution HTTP locale. |

Les identifiants de `.env.example` sont des valeurs de développement local, pas des secrets de production. `.env` est exclu de Git et du contexte Docker. Si vous changez `POSTGRES_PASSWORD` pour Compose, adaptez les URL locales en conséquence. Un mot de passe contenant des caractères réservés doit être encodé dans l’URL PostgreSQL.

## Découvrir Flow en deux minutes

1. Ouvrez **Explore the live demo** : le planning du jour montre immédiatement des tâches actives, une activité passive et deux événements fixes.
2. Capturez une idée dans le champ **Capture a task…** de l’Inbox. Un titre suffit ; les valeurs initiales sont une activité active de 30 minutes, de priorité moyenne.
3. Choisissez au besoin une journée future, puis **Organize my day**. Les tâches trouvent les premiers créneaux compatibles ; les blocs existants restent à leur place.
4. Ouvrez une tâche pour préciser sa durée, son projet ou son échéance. **Choose a time** permet de choisir une date et une heure sans glisser-déposer.
5. Déplacez un bloc avec sa poignée ou étirez son bord inférieur. Les flèches haut/bas sur ces poignées offrent la même action au clavier.
6. Cochez une tâche : elle reste visible dans son créneau et se retrouve dans **Completed**.

Une journée passée ou déjà remplie peut ne laisser aucun créneau : l’Inbox affiche alors la raison. La planification ne déplace jamais silencieusement les engagements existants.

## Docker Compose : application complète

```bash
docker compose up --build -d
docker compose logs -f app
```

Ouvrez **http://localhost:8080**. L’image construit le frontend et le backend ; Express sert les deux depuis une seule origine. Le conteneur attend PostgreSQL puis applique les migrations avant de démarrer. Il s’exécute avec l’utilisateur non privilégié `node`.

Les ports sont publiés sur `127.0.0.1` uniquement. Le volume `flow_pgdata` conserve les données. Cette configuration est destinée à la machine locale ; elle utilise HTTP et désactive explicitement le drapeau `Secure` des cookies. Pour une installation HTTPS autorisée, utilisez `DOCKER_COOKIE_SECURE=true` et une `DOCKER_APP_ORIGIN` correspondant à l’URL HTTPS. Aucun déploiement public n’est inclus dans ce workflow.

```bash
docker compose ps
docker compose stop
```

Changer le mot de passe d’un volume PostgreSQL existant exige une modification du rôle SQL ; changer la variable Compose seule ne modifie pas ce volume. Sauvegardez vos données avant toute migration ou opération administrative sur une base contenant des informations importantes.

Le build peut aussi être lancé directement sur la machine, sans conteneur applicatif :

```bash
npm run build
# HTTP local uniquement ; PostgreSQL doit déjà être démarré et migré.
NODE_ENV=production APP_ORIGIN="http://localhost:3001" COOKIE_SECURE=false npm start
```

Ouvrez alors **http://localhost:3001**. Avec HTTPS, conservez le comportement `Secure` par défaut et configurez l’origine HTTPS exacte.

## Tests et vérifications

Le service PostgreSQL Compose crée `flow` et `flow_test` lors de l’initialisation d’un volume neuf. Appliquez aussi les migrations à la base de test :

```bash
# Valeur locale de .env.example ; adaptez-la si votre configuration diffère.
DATABASE_URL="postgresql://flow:flow_local_password@localhost:5432/flow_test?schema=public" npm run db:migrate

npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` charge `.env`, exécute les tests unitaires, les tests React et les tests d’API sur une vraie base PostgreSQL. Les tests d’API refusent une base dont le nom ne se termine pas par `_test` et nettoient uniquement les utilisateurs qu’ils ont créés. Ils ne réinitialisent pas la base de développement.

Commandes ciblées :

```bash
npm run test:unit
npm run test:api
npx playwright install chromium
E2E_BASE_URL="http://localhost:5173" npm run test:e2e
```

Playwright démarre les serveurs de développement si nécessaire, ou réutilise ceux déjà lancés hors CI. `.env.example` autorise les deux adresses `http://localhost:5173` et `http://127.0.0.1:5173`, cette dernière étant le défaut Playwright. Une URL personnalisée doit aussi être présente dans `APP_ORIGIN`. Les parcours navigateur écrivent de vraies données : utilisez un environnement local ou une base dédiée aux vérifications, jamais une base de production.

Les tests couvrent l’ordre déterministe, les deux catégories d’attention, les événements fixes, les placements manuels, les échéances, l’absence de doublons, les journées pleines, les changements d’heure, la persistance, l’authentification, l’isolation et les conflits d’écriture. Les traces et captures des échecs E2E restent dans `test-results/` et `playwright-report/`. La CI reprend lint, TypeScript, tests, build et E2E avec un PostgreSQL éphémère.

Si `flow_test` manque sur un volume créé avant l’ajout du script d’initialisation, créez-la sans supprimer le volume :

```bash
docker compose exec db psql -U flow -d postgres -c 'CREATE DATABASE flow_test OWNER flow;'
```

## Organisation du code

```text
src/                 React, composants, client HTTP et styles
shared/              Types, temps, placement automatique et chevauchements
server/              Express, sessions, validation, sérialisation et démo
prisma/              Modèle relationnel et migrations versionnées
tests/               Tests unitaires, React, API PostgreSQL et E2E
docs/                Architecture, algorithme, UX et limites
scripts/             Initialisation de la base de test locale
```

La stack privilégie une architecture individuelle lisible : **React 19 + TypeScript + Vite**, **Express 5**, **PostgreSQL + Prisma 6**, **Motion**, **Lucide**, **Zod** et **Temporal**. Les styles utilisent des variables CSS et des composants locaux plutôt qu’une couche Tailwind supplémentaire. Le moteur de planification ne connaît ni React ni Prisma.

- [Publier le portfolio sur Render avec Neon](docs/DEPLOYMENT.md)
- [Architecture et sécurité](docs/architecture.md)
- [Algorithme de planification](docs/planning.md)
- [Choix UX et interactions](docs/ux.md)
- [Limitations connues](docs/limitations.md)
- [Résultats des vérifications : 58 tests et 11 scénarios E2E](docs/verification.md)

Le projet ne comprend pas de synchronisation calendrier, de tâches récurrentes, de collaboration ou de récupération de mot de passe. La disponibilité comporte une plage identique chaque jour ; le moteur ne découpe pas une tâche en plusieurs blocs. Ces limites sont détaillées dans la documentation.
