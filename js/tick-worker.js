// Reloj en un worker: los navegadores no frenan sus temporizadores cuando la
// pestaña está en segundo plano, así los cambios de bloque llegan a tiempo.
setInterval(() => postMessage(0), 250);
