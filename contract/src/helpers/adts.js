const Either = (() => {
  const Right = x => ({
    isLeft: false,
    chain: f => f(x),
    ap: other => other.map(x),
    alt: _ => Right(x),
    extend: f => f(Right(x)),
    concat: other =>
      other.fold(
        _ => other,
        y => Right(x.concat(y)),
      ),
    traverse: (of, f) => f(x).map(Right),
    map: f => Right(f(x)),
    fold: (_, g) => g(x),
    inspect: () => `Right(${x})`,
  });

  const Left = x => ({
    isLeft: true,
    chain: _ => Left(x),
    ap: _ => Left(x),
    extend: _ => Left(x),
    alt: other => other,
    concat: _ => Left(x),
    traverse: (of, _) => of(Left(x)),
    map: _ => Left(x),
    fold: (f, _) => f(x),
    inspect: () => `Left(${x})`,
  });

  const of = Right;
  const tryCatch = f => {
    try {
      return Right(f());
    } catch (e) {
      return Left(e);
    }
  };

  const fromUndefined = x => (x === undefined ? Right(x) : Left(x));

  const fromNullable = x => (x != null ? Right(x) : Left(x));

  return { Right, Left, of, tryCatch, fromNullable, fromUndefined };
})();

const Observable = subscribe => ({
  // Subscribes to the observable
  subscribe,
  map: f =>
    Observable(observer =>
      subscribe({
        next: val => observer.next(f(val)),
        error: err => observer.error(err),
        complete: () => observer.complete(),
      }),
    ),
  // Transforms the observable itself using a function that returns an observable
  chain: f =>
    Observable(observer =>
      subscribe({
        next: val => f(val).subscribe(observer),
        error: err => observer.error(err),
        complete: () => observer.complete(),
      }),
    ),
  // Combines two observables process to behave as one
  concat: other =>
    Observable(observer => {
      let completedFirst = false;
      const completeFirst = () => {
        completedFirst = true;
        other.subscribe(observer);
      };
      subscribe({
        next: val => observer.next(val),
        error: err => observer.error(err),
        complete: completeFirst,
      });
      if (completedFirst) {
        other.subscribe(observer);
      }
    }),
});

// Static method to create an observable from a single value
Observable.of = x =>
  Observable(observer => {
    observer.next(x);
    observer.complete();
  });

// Static method to create an observational from asynchronous computation
Observable.fromPromise = promise =>
  Observable(observer => {
    promise
      .then(val => {
        observer.next(val);
        observer.complete();
      })
      .catch(err => observer.error(err));
  });

export { Either, Observable };
