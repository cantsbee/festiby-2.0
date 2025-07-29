import './style.css'
import { Button } from './components/Button.js';
import { TextArea } from './components/TextArea.js';
import { Section } from './components/Section.js';
import { ResultList } from './components/ResultList.js';

window.addEventListener('DOMContentLoaded', () => {
  // --- CONFIGURACIÓN SPOTIFY ---
  const CLIENT_ID = '6e4ca8910c3c479ea21b9de20ca7646c'; 
  const REDIRECT_URI = 'https://festiby.vercel.app/'; // Redirección a la app en Vercel
  const SCOPES = 'user-top-read';

  // --- CREAR INTERFAZ MODULAR ---
  let loginBtn, userInfo, artistTextArea, analyzeBtn, inputSection, resultsList, resultsSection, errorMsg;

  function createUI() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // Título
    const title = document.createElement('h1');
    title.textContent = 'Recomendador de Artistas para tu Spotify';
    app.appendChild(title);

    // Mensaje de error
    errorMsg = document.createElement('div');
    errorMsg.id = 'error-msg';
    errorMsg.style.display = 'none';
    errorMsg.style.background = '#ff4d4f';
    errorMsg.style.color = '#fff';
    errorMsg.style.padding = '0.7em 1em';
    errorMsg.style.borderRadius = '8px';
    errorMsg.style.margin = '1em auto';
    errorMsg.style.maxWidth = '400px';
    errorMsg.style.fontWeight = 'bold';
    app.appendChild(errorMsg);

    // Botón login
    loginBtn = Button({ id: 'login-btn', text: 'Iniciar sesión con Spotify' });
    app.appendChild(loginBtn);

    // Info usuario
    userInfo = document.createElement('div');
    userInfo.id = 'user-info';
    userInfo.style.display = 'none';
    app.appendChild(userInfo);

    // TextArea de artistas
    artistTextArea = TextArea({ id: 'artist-list', placeholder: 'Ejemplo:\nRosalía\nC. Tangana\nBad Bunny', rows: 8, cols: 40 });
    // Botón analizar
    analyzeBtn = Button({ id: 'analyze-btn', text: 'Analizar' });
    // Sección input
    inputSection = Section({
      id: 'input-section',
      title: 'Pega tu listado de artistas (uno por línea):',
      children: [artistTextArea, document.createElement('br'), analyzeBtn],
    });
    inputSection.style.display = 'none';
    app.appendChild(inputSection);

    // Sección resultados
    resultsList = ResultList({ id: 'results-list' });
    resultsSection = Section({
      id: 'results-section',
      title: 'Artistas que más te pueden gustar:',
      children: [resultsList],
    });
    resultsSection.style.display = 'none';
    app.appendChild(resultsSection);
  }

  // --- PKCE UTILS ---
  function base64urlencode(a) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return await window.crypto.subtle.digest('SHA-256', data);
  }

  async function generateCodeChallenge(codeVerifier) {
    const hashed = await sha256(codeVerifier);
    return base64urlencode(hashed);
  }

  function generateRandomString(length) {
    const array = new Uint32Array(length);
    window.crypto.getRandomValues(array);
    return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('').substr(0, length);
  }

  // --- INICIALIZACIÓN ---
  createUI();

  let accessToken = localStorage.getItem('spotify_access_token');

  // Asignar eventos después de crear los elementos
  loginBtn.onclick = async () => {
    errorMsg.style.display = 'none';
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    localStorage.setItem('spotify_code_verifier', codeVerifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });
    window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
  };

  analyzeBtn.onclick = async () => {
    errorMsg.style.display = 'none';
    resultsSection.style.display = 'none';
    resultsList.innerHTML = '';
    const input = artistTextArea.value;
    const artistNames = input.split('\n').map(a => a.trim()).filter(Boolean);
    if (!artistNames.length) {
      errorMsg.textContent = 'Introduce al menos un artista.';
      errorMsg.style.display = 'block';
      return;
    }
    // 1. Obtener tus artistas y géneros favoritos
    let userTopArtists = [];
    try {
      userTopArtists = await getUserTopArtists();
    } catch (e) {
      errorMsg.textContent = 'Error obteniendo tus artistas de Spotify. ¿Has iniciado sesión?';
      errorMsg.style.display = 'block';
      console.error('Error getUserTopArtists', e);
      return;
    }
    const userGenres = new Set(userTopArtists.flatMap(a => a.genres));
    const userArtistNames = new Set(userTopArtists.map(a => a.name.toLowerCase()));

    // 2. Buscar los artistas introducidos y obtener sus géneros
    const analyzed = [];
    for (const name of artistNames) {
      const search = await searchArtist(name);
      if (!search) continue;
      // 3. Comparar: +2 si es artista favorito, +1 por cada género en común
      let score = 0;
      if (userArtistNames.has(search.name.toLowerCase())) score += 2;
      const commonGenres = search.genres.filter(g => userGenres.has(g));
      score += commonGenres.length;
      analyzed.push({
        name: search.name,
        genres: search.genres,
        score,
        commonGenres,
        url: search.external_urls.spotify,
      });
    }
    // 4. Ordenar y mostrar
    analyzed.sort((a, b) => b.score - a.score);
    for (const a of analyzed) {
      const li = document.createElement('li');
      li.innerHTML = `<a href="${a.url}" target="_blank">${a.name}</a> (${a.genres.join(', ')})<br>Puntuación: <b>${a.score}</b> ${a.commonGenres.length ? ' | Géneros en común: ' + a.commonGenres.join(', ') : ''}`;
      resultsList.appendChild(li);
    }
    resultsSection.style.display = 'block';
  };

  // --- FLUJO PKCE Y LÓGICA DE AUTENTICACIÓN ---
  async function handleAuth() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      console.log('Recibido code de Spotify:', code);
      // Intercambiar code por token
      const codeVerifier = localStorage.getItem('spotify_code_verifier');
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      });
      try {
        const res = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const data = await res.json();
        console.log('Respuesta de /api/token:', data);
        if (data.access_token) {
          accessToken = data.access_token;
          localStorage.setItem('spotify_access_token', accessToken);
          window.history.replaceState({}, document.title, '/'); // Limpia el code de la URL
          showLoggedUI();
        } else {
          errorMsg.textContent = 'Error autenticando con Spotify: ' + (data.error_description || data.error || 'Desconocido');
          errorMsg.style.display = 'block';
          showLoginUI();
        }
      } catch (e) {
        errorMsg.textContent = 'Error de red al autenticar con Spotify.';
        errorMsg.style.display = 'block';
        showLoginUI();
        console.error('Error en fetch /api/token', e);
      }
    } else if (accessToken) {
      showLoggedUI();
    } else {
      showLoginUI();
    }
  }

  function showLoginUI() {
    console.log('Mostrando login UI');
    loginBtn.style.display = 'block';
    userInfo.style.display = 'none';
    inputSection.style.display = 'none';
    resultsSection.style.display = 'none';
  }

  function showLoggedUI() {
    console.log('Mostrando UI de usuario logueado');
    loginBtn.style.display = 'none';
    userInfo.style.display = 'block';
    inputSection.style.display = 'block';
    resultsSection.style.display = 'none';
    errorMsg.style.display = 'none';
    showUserInfo();
  }

  // --- OBTENER INFO DE USUARIO Y TOP ARTISTAS ---
  async function showUserInfo() {
    try {
      const user = await fetchSpotify('https://api.spotify.com/v1/me');
      userInfo.innerHTML = `<p>¡Hola, ${user.display_name}!</p>`;
    } catch (e) {
      errorMsg.textContent = 'No se pudo obtener la información de usuario de Spotify.';
      errorMsg.style.display = 'block';
      userInfo.innerHTML = '';
      console.error('Error showUserInfo', e);
    }
  }

  async function getUserTopArtists() {
    const res = await fetchSpotify('https://api.spotify.com/v1/me/top/artists?limit=50');
    return res.items;
  }

  // --- UTILIDAD PARA LLAMADAS A SPOTIFY ---
  async function fetchSpotify(url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('Error en la API de Spotify');
    return res.json();
  }

  // --- BUSCAR ARTISTA EN SPOTIFY ---
  async function searchArtist(name) {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`;
    const res = await fetchSpotify(url);
    return res.artists.items[0];
  }

  // --- INICIO ---
  handleAuth();
});


