import React, { useState, useEffect } from 'react';
import { includes, filter, isEmpty, map, prop, pipe } from 'ramda';
import { List, LIST_ITEMS } from './types.js';
import { Task } from '../../shared/helpers/adts.js';

const mockFetchList = runAfterSeconds =>
   Task((reject, resolve) =>
    setTimeout(() => resolve(LIST_ITEMS), runAfterSeconds * 1000),
  );

const hasInTitle = searchString => item =>
  includes(searchString, prop('title', item));

const ConnectAccount = () => {
  const [list, setList] = useState(List.Initial);
  const [searchString, setSearchString] = useState('');

  const fetchList = () =>
    mockFetchList(3).fork(
      () => setList(List.FetchError),
      pipe(wrapFetchedList, setList),
    );

  const wrapFetchedList = list =>
    isEmpty(list) ? List.Empty : List.Items(list);

  const wrapFilteredList = list =>
    isEmpty(list) ? List.NotFound(searchString) : List.Items(list);

  const filterList = () =>
    list.cata({
      Empty: () => List.Empty,
      Initial: () => List.Initial,
      Items: pipe(filter(hasInTitle(searchString)), wrapFilteredList),
      NotFound: () => List.NotFound(searchString),
      FetchError: () => List.FetchError,
    });

  const onSearchFieldChange = ({ target }) =>
    setSearchString(() => target.value);

  useEffect(() => {
    fetchList();
  });

  return (
    <div className="App">
      <header className="App-header">
        {'Pattern matching in React with Daggy'}
      </header>
      <article className={'App-body'}>
        <input
          onChange={onSearchFieldChange}
          placeholder={'Type your search ...'}
        />
        <ul className={'center'}>
          {filterList().cata({
            Empty: () => <li>{'This list is empty'}</li>,
            Initial: () => <li>{'Loading...'}</li>,
            Items: map(({ title }) => <li key={title}>{title}</li>),
            NotFound: searchMessage => (
              <li>{`There are no results for '${searchMessage}'`}</li>
            ),
            FetchError: () => <li>{'Oooooops...'}</li>,
          })}
        </ul>
      </article>
    </div>
  );
};

export default ConnectAccount;
