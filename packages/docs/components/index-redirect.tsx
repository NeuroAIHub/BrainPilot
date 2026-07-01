export function IndexRedirect({ target }: { target: string }) {
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${target}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `location.replace(${JSON.stringify(target)})`,
        }}
      />
      <p style={{ padding: '2rem' }}>
        Redirecting to <a href={target}>{target}</a>...
      </p>
    </>
  );
}
