# CraftLauncher

Launcher Minecraft public avec authentification Microsoft officielle.

---

## Structure du projet

```
craftlauncher/
├── src/
│   ├── main.js                  ← Point d'entrée Electron
│   ├── preload.js               ← Pont sécurisé renderer ↔ main
│   ├── auth/
│   │   └── microsoft-auth.js   ← Auth Microsoft OAuth complète
│   ├── core/
│   │   └── launcher.js         ← Lancement Minecraft via minecraft-launcher-core
│   └── instances/
│       └── manager.js          ← Gestion des instances
├── renderer/
│   ├── index.html              ← Interface principale
│   ├── app.js                  ← Logique UI
│   └── style.css               ← Styles
├── assets/                     ← Icônes de l'app
└── package.json
```

---

## Installation

```bash
npm install
npm start          # Lancer en développement
npm run build:win  # Build Windows (.exe)
npm run build:mac  # Build macOS (.dmg)
npm run build:linux # Build Linux (.AppImage)
```

---

## ⚠️ ÉTAPE OBLIGATOIRE — Créer votre app Azure

Sans cette étape, l'authentification Microsoft ne fonctionnera pas.

### 1. Créer l'app sur Azure Portal

1. Allez sur https://portal.azure.com
2. Connectez-vous avec un compte Microsoft (le vôtre suffit)
3. Cherchez **"Inscriptions d'applications"** (App registrations)
4. Cliquez **"Nouvelle inscription"**
5. Remplissez :
   - **Nom** : CraftLauncher (ou ce que vous voulez)
   - **Types de comptes pris en charge** : ✅ Comptes Microsoft personnels uniquement
   - **URI de redirection** : sélectionnez "Web" → `http://localhost:8080/callback`
6. Cliquez **"S'inscrire"**

### 2. Récupérer le Client ID

Sur la page de votre app, copiez l'**"ID d'application (client)"** — c'est un UUID du type `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

### 3. Coller dans le code

Ouvrez `src/auth/microsoft-auth.js` et remplacez :

```js
const CLIENT_ID = 'VOTRE_CLIENT_ID_AZURE';
```

par votre vrai Client ID.

### 4. Aucun secret client nécessaire

Ce launcher utilise le flux **PKCE / public client** — pas besoin de secret.
Le mot de passe du joueur est saisi directement sur la page Microsoft et n'est **jamais transmis** à votre app.

---

## Compte admin

L'UUID admin est défini dans deux fichiers :

- `src/auth/microsoft-auth.js` → `ADMIN_UUIDS`
- `renderer/app.js` → `ADMIN_UUIDS`

UUID admin actuel : `8a501859-8fb7-443f-ab18-0909b41b3275`

## Sync multi-PC avec Supabase

Le launcher peut maintenant partager les admins et les modpacks publies entre plusieurs PC.

Fichiers ajoutes :

- `supabase-schema.sql` : structure SQL a executer dans Supabase
- `.env.example` : variables a renseigner dans votre `.env`

Variables attendues :

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_public_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_for_admin_pc_only
```

Notes :

- `SUPABASE_ANON_KEY` suffit pour lire les admins et les modpacks publies sur tous les PC
- `SUPABASE_SERVICE_ROLE_KEY` est utilisee pour publier/supprimer a distance et doit rester sur le PC admin uniquement
- sans config Supabase, le launcher continue de fonctionner en local

---

## Flux d'authentification (résumé)

```
Joueur clique "Se connecter"
  → Fenêtre Microsoft OAuth s'ouvre (Electron BrowserWindow)
  → Le joueur entre son email + mot de passe sur microsoft.com
  → Microsoft redirige vers localhost:8080/callback avec un code
  → Le code est échangé contre un access_token + refresh_token Microsoft
  → Le launcher obtient un token Xbox Live (XBL)
  → Puis un token XSTS (Minecraft services)
  → Puis un token Minecraft (access_token MC)
  → Puis le profil complet : UUID, username, skin, cape
  → Les tokens sont sauvegardés chiffrés (electron-store)
  → Au prochain lancement : refresh automatique, pas de reconnexion
```

---

## Skin officiel

Le skin est chargé via l'API Minecraft officielle :
- URL du skin brut : fournie par `api.minecraftservices.com/minecraft/profile`
- Rendu tête 2D : `https://crafatar.com/avatars/{UUID}?size=28&overlay`
- Rendu corps complet : `https://crafatar.com/renders/body/{UUID}?size=80&overlay`

---

## Java requis

Le launcher détecte automatiquement Java selon la version MC :
- MC 1.20.5+ → Java 21
- MC 1.17–1.20.4 → Java 17
- MC 1.12.2 et avant → Java 8

Vous pouvez forcer le chemin Java par instance dans les paramètres.
